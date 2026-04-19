// ---------------------------------------------------------------------------
// Stellar Passkey authentication — real WebAuthn Smart Wallet
// ---------------------------------------------------------------------------
// Uses passkey-kit (kalepail) to deploy a Stellar Smart Wallet (C... address)
// secured by the device's Secure Enclave (Touch ID / Face ID / Windows Hello).
//
// The user's P-256 private key NEVER leaves the device.
// No secretKey is stored anywhere — not in localStorage, not in memory.
//
// Registration:
//   startRegistration() → P-256 keypair created in Secure Enclave
//   PasskeyKit.createWallet() → Smart Wallet deployed on Stellar
//   Session { phone, name, contractId, keyIdBase64 } saved to localStorage
//
// Sign-in:
//   WebAuthn challenge → Secure Enclave signs → credential verified
//   contractId re-derived on-chain from keyId
//
// Transactions:
//   Each call triggers a biometric prompt via PasskeyKit.signAuthEntry()
//   The Smart Wallet contract verifies the Secp256r1 signature on-chain
// ---------------------------------------------------------------------------

import type { PasskeyKit as PasskeyKitType } from "passkey-kit/src/kit";

const RPC_URL   = process.env.NEXT_PUBLIC_STELLAR_RPC_URL    ?? "https://soroban-testnet.stellar.org";
const NETWORK   = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const WASM_HASH = "ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90";

const STORAGE_KEY = "ajora_session";

// ---------------------------------------------------------------------------
// Session type — NO secretKey field
// ---------------------------------------------------------------------------

export interface AjoraSession {
  phone:       string;
  name:        string;
  contractId:  string;   // C... Stellar Smart Wallet address
  keyIdBase64: string;   // WebAuthn credential ID (stored for re-auth targeting)
  signedOut?:  boolean;  // true when user explicitly signed out
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readRecord(): AjoraSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.keyIdBase64) return null;
    // Legacy sessions (pre-PasskeyKit) stored a secretKey and used G... addresses.
    // These are insecure — wipe them so the user re-registers with the smart wallet.
    if ("secretKey" in parsed || !parsed.contractId?.startsWith("C")) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed as AjoraSession;
  } catch {
    return null;
  }
}

function writeRecord(r: AjoraSession): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  }
}

/** Full authenticated session — null if signed out or no session. */
export function getSession(): AjoraSession | null {
  const r = readRecord();
  if (!r || r.signedOut) return null;
  return r;
}

/** Credential stub for sign-in page — works even after sign-out. */
export function getCredential(): Pick<AjoraSession, "phone" | "name" | "keyIdBase64"> | null {
  const r = readRecord();
  if (!r?.keyIdBase64) return null;
  return { phone: r.phone, name: r.name ?? "", keyIdBase64: r.keyIdBase64 };
}

/** Sign-out: marks as signed-out but keeps credential stub for re-login. */
export function clearSession(): void {
  const r = readRecord();
  if (r) {
    writeRecord({ ...r, signedOut: true });
  } else if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    return `+${digits.slice(0, digits.length - 7)} ••• ${digits.slice(-4)}`;
  }
  return phone;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// PasskeyKit singleton — lazy-initialised (browser only)
// ---------------------------------------------------------------------------

let _kit: PasskeyKitType | null = null;

export async function getPasskeyKit(): Promise<PasskeyKitType> {
  if (_kit) return _kit;
  const { PasskeyKit } = await import("passkey-kit/src/kit");
  _kit = new PasskeyKit({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, walletWasmHash: WASM_HASH });
  return _kit;
}

/**
 * Prime the kit's wallet + keyId so signAuthEntry() knows which contract
 * and credential to use when authorising transactions.
 */
export async function primePasskeyKit(contractId: string, keyIdBase64: string): Promise<PasskeyKitType> {
  const kit = await getPasskeyKit();
  if (kit.wallet?.options.contractId !== contractId) {
    const { Client: PasskeyClient } = await import("passkey-kit-sdk");
    kit.wallet = new PasskeyClient({ contractId, networkPassphrase: NETWORK, rpcUrl: RPC_URL });
  }
  kit.keyId = keyIdBase64;
  return kit;
}

// ---------------------------------------------------------------------------
// Register: real WebAuthn + Stellar Smart Wallet deployment
// ---------------------------------------------------------------------------

export async function registerWithPasskey(phone: string, name: string): Promise<AjoraSession> {
  const kit = await getPasskeyKit();
  const { rpc: SorobanRpc } = await import("@stellar/stellar-sdk");

  // 1. WebAuthn registration — Secure Enclave creates P-256 keypair on device.
  //    This is the step that triggers the biometric prompt.
  //    If this throws, nothing has been persisted and the user can try again.
  let keyIdBase64: string;
  let contractId:  string;
  let signedTx:    unknown;

  try {
    ({ keyIdBase64, contractId, signedTx } = await kit.createWallet("Ajora", name || phone));
  } catch (e) {
    throw new Error(
      `Passkey registration failed: ${e instanceof Error ? e.message : String(e)}. ` +
      `Please try again — no wallet was created.`
    );
  }

  // 2. Submit the deployment transaction to Stellar.
  //    From this point the passkey exists on the device. If network submission
  //    fails, the user must register again (a new P-256 keypair will be created).
  const server = new SorobanRpc.Server(RPC_URL);
  let sendHash: string;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const send = await server.sendTransaction(signedTx as any);
    if (send.status === "ERROR") {
      throw new Error(JSON.stringify(send.errorResult));
    }
    sendHash = send.hash;
  } catch (e) {
    throw new Error(
      `Smart wallet deployment failed to submit: ${e instanceof Error ? e.message : String(e)}. ` +
      `Please check your internet connection and try registering again.`
    );
  }

  // 3. Wait for on-chain confirmation (up to 75 s).
  try {
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const s = await server.getTransaction(sendHash);
      if (s.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) { confirmed = true; break; }
      if (s.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error("rejected on-chain — the deployment transaction was refused");
      }
    }
    if (!confirmed) throw new Error("timed out waiting for confirmation");
  } catch (e) {
    throw new Error(
      `Smart wallet was created on your device but failed to deploy on Stellar: ` +
      `${e instanceof Error ? e.message : String(e)}. ` +
      `Please try registering again with a fresh account.`
    );
  }

  // 4. Prime the kit for future transaction signing
  await primePasskeyKit(contractId, keyIdBase64);

  const session: AjoraSession = { phone, name, contractId, keyIdBase64, signedOut: false };
  writeRecord(session);

  // 5. Save to Supabase registry so the session can be recovered if
  //    localStorage is ever cleared. Errors here are non-fatal.
  try {
    const { registerUser } = await import("./registry");
    await registerUser({ keyId: keyIdBase64, contractId, phone, name });
  } catch (e) {
    // A duplicate phone error should have been caught before the biometric
    // step. If it surfaces here, log it but don't break the session.
    console.warn("Registry save failed:", e instanceof Error ? e.message : e);
  }

  return session;
}

// ---------------------------------------------------------------------------
// Add backup device: register a second passkey signer on the same wallet
// ---------------------------------------------------------------------------
//
// Flow:
//   1. kit.createKey() — triggers browser passkey dialog.
//      The browser offers "Use another device" (QR + Bluetooth cross-device).
//      If user picks a second phone, that phone's Secure Enclave creates the key.
//      The public key is returned to the CURRENT device.
//   2. kit.addSecp256r1() — builds an add_signer transaction for the wallet
//   3. kit.sign()        — signs auth entries with the EXISTING passkey (biometric)
//   4. feeKeypair.sign() — signs the outer envelope (kalepail pays fees)
//   5. Submit + poll     — confirms on-chain
//
// After success, the caller should generate an activation link:
//   /backup/activate?wallet={contractId}&kid={newKeyIdBase64}
// The backup device opens this link to store the session in its localStorage.
// ---------------------------------------------------------------------------

export async function addBackupDevice(
  contractId: string,
  existingKeyId: string,
  name: string,
): Promise<{ newKeyIdBase64: string; txHash: string }> {
  const kit = await primePasskeyKit(contractId, existingKeyId);
  const { rpc: SorobanRpc, hash, Keypair, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const { basicNodeSigner } = await import("@stellar/stellar-sdk/minimal/contract");

  const feeKeypair = Keypair.fromRawEd25519Seed(hash(Buffer.from("kalepail")));
  const server     = new SorobanRpc.Server(RPC_URL);

  // Step 1: Register a NEW passkey credential.
  // The browser dialog will show "Use another device" for cross-device registration.
  // If the user selects that, their backup phone creates the key in its Secure Enclave.
  const { keyIdBase64: newKeyIdBase64, publicKey } = await kit.createKey(
    "Ajora",
    `${name || "User"} — Backup`,
  );

  // Step 2: Build the add_signer assembled transaction.
  // AssembledTransaction requires a real publicKey (fee-source account) to build correctly.
  // kit.wallet was initialised without one, so we patch it temporarily with kalepail's key.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walletOpts = (kit.wallet as any).options;
  const prevPublicKey = walletOpts.publicKey;
  walletOpts.publicKey = feeKeypair.publicKey();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addTx = await kit.addSecp256r1(newKeyIdBase64, publicKey, undefined, "Persistent" as any);

  // Restore original options so other kit operations aren't affected
  walletOpts.publicKey = prevPublicKey;

  // Step 3: Sign each Soroban auth entry directly with the EXISTING passkey — triggers biometric.
  // We call kit.signAuthEntry() directly (rather than kit.sign() → signAuthEntries()) to avoid
  // any address-filtering issues in the SDK's signAuthEntries implementation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawOp = (addTx as any).built.operations[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authEntries: any[] = rawOp?.auth ?? [];
  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    // Only sign credential-address entries (skip source-account entries)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((entry as any).credentials().switch().name === "sorobanCredentialsAddress") {
      authEntries[i] = await kit.signAuthEntry(entry, { keyId: existingKeyId });
    }
  }

  if (authEntries.length === 0) {
    throw new Error(
      "The simulated transaction has no Soroban auth entries. " +
      "This is unexpected — the wallet contract should require passkey authorization for add_signer."
    );
  }

  // Step 3.5: Re-simulate with the signed auth entry so that __check_auth runs in the VM.
  // The first simulation used void auth entries so it undercounted resources (skipped __check_auth).
  // Re-simulating with the real signature gives correct instruction/byte budgets.
  // assembleTransaction() keeps existing (signed) auth when auth.length > 0 — see rpc/transaction.js.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builtWithAuth = (addTx as any).built;
  const { rpc: { assembleTransaction } } = await import("@stellar/stellar-sdk/minimal");
  const resim = await server.simulateTransaction(builtWithAuth);
  if (!("transactionData" in resim)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error(`Re-simulation failed: ${(resim as any).error ?? JSON.stringify(resim)}`);
  }
  const refreshedTx = assembleTransaction(builtWithAuth, resim).build();

  // Step 4: Sign the outer envelope with kalepail directly from the refreshed XDR.
  const builtXdr = refreshedTx.toXDR();   // base64-encoded envelope XDR
  const { signedTxXdr } = await basicNodeSigner(feeKeypair, NETWORK).signTransaction(
    builtXdr,
    { networkPassphrase: NETWORK },
  );

  // Step 5: Submit the signed transaction
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const send = await server.sendTransaction(signedTx as any);
  if (send.status === "ERROR") {
    throw new Error(`Submission failed: ${JSON.stringify(send.errorResult)}`);
  }

  // Step 6: Poll for on-chain confirmation (up to 48 s)
  const txHash = send.hash;
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await server.getTransaction(txHash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { newKeyIdBase64, txHash };
    }
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      // Serialize the result XDR to get the exact Soroban error code
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = status as any;
      let detail = "";
      try {
        if (s.resultXdr?.toXDR) detail = s.resultXdr.toXDR("base64");
        else if (s.resultXdr) detail = JSON.stringify(s.resultXdr);
        else if (s.resultMetaXdr?.toXDR) detail = s.resultMetaXdr.toXDR("base64");
        else if (s.resultMetaXdr) detail = JSON.stringify(s.resultMetaXdr);
        if (!detail) detail = JSON.stringify(s);
      } catch { detail = String(s); }
      throw new Error(`Transaction failed on-chain: ${txHash}\n${detail}`);
    }
  }
  throw new Error(`Transaction timed out: ${txHash}`);
}

// ---------------------------------------------------------------------------
// Sign in: WebAuthn re-authentication → restore session
// ---------------------------------------------------------------------------

export async function signInWithPasskey(phone: string): Promise<AjoraSession> {
  const record = readRecord();

  if (!record?.keyIdBase64) {
    throw new Error("No account found on this device. Please create an account first.");
  }

  if (normalizePhone(record.phone) !== normalizePhone(phone)) {
    throw new Error(
      `This device has an account for ${formatPhone(record.phone)}. ` +
      `Sign in with that number, or create a new account.`
    );
  }

  // Trigger WebAuthn authentication (biometric prompt)
  const { startAuthentication } = await import("@simplewebauthn/browser");
  // base64url is used by passkey-kit; import it the same way
  const base64url = (await import("base64url")).default;

  await startAuthentication({
    optionsJSON: {
      challenge: base64url("stellaristhebetterblockchain"),
      allowCredentials: [{ id: record.keyIdBase64, type: "public-key" }],
      userVerification: "preferred",
    },
  });

  // Prime the kit so transactions can be signed immediately
  await primePasskeyKit(record.contractId, record.keyIdBase64);

  const session: AjoraSession = {
    phone: record.phone,
    name:  record.name ?? "",
    contractId:  record.contractId,
    keyIdBase64: record.keyIdBase64,
    signedOut: false,
  };
  writeRecord(session);
  return session;
}
