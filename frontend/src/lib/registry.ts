// ---------------------------------------------------------------------------
// Supabase user registry
// ---------------------------------------------------------------------------
// Stores the mapping:  keyId (WebAuthn credential ID) → contractId + phone + name
//
// Solves two problems:
//   1. Account recovery — if localStorage is cleared, the user can re-authenticate
//      via WebAuthn discoverable mode and look up their contractId by keyId.
//   2. Phone uniqueness — phone numbers are UNIQUE in the table so duplicate
//      registrations are blocked before the biometric step.
//
// The anon key is safe here because:
//   - INSERT: any client can insert a new row (RLS: with check(true))
//   - SELECT: any client can read rows (RLS: using(true))
//   No sensitive key material is stored — only public blockchain addresses.
//
// Future: add Supabase Phone Auth (OTP via Twilio) to this same project
//   supabase.auth.signInWithOtp({ phone }) — no new project needed.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export interface RegistryUser {
  keyId:      string;
  contractId: string;
  phone:      string;
  name:       string;
}

// ---------------------------------------------------------------------------
// Check if a phone number is already registered.
// Call this BEFORE triggering the biometric prompt.
// Returns true if the phone is available, false if already taken.
// ---------------------------------------------------------------------------
export async function isPhoneAvailable(phone: string): Promise<boolean> {
  if (!SUPABASE_URL) return true; // registry not configured — skip check
  const normalized = phone.replace(/\D/g, "");
  const { data, error } = await supabase
    .from("users")
    .select("key_id")
    .eq("phone", normalized)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found, which is the "available" case
    console.warn("Registry phone check failed:", error.message);
    return true; // fail open — don't block registration on network error
  }
  return data === null;
}

// ---------------------------------------------------------------------------
// Register a new user after their smart wallet has been deployed on Stellar.
// ---------------------------------------------------------------------------
export async function registerUser(user: RegistryUser): Promise<void> {
  if (!SUPABASE_URL) return;
  const { error } = await supabase.from("users").insert({
    key_id:      user.keyId,
    contract_id: user.contractId,
    phone:       user.phone.replace(/\D/g, ""),
    name:        user.name,
  });
  if (error) {
    // Duplicate phone (unique constraint) — surface as user-facing error
    if (error.code === "23505") {
      throw new Error("An account already exists for this phone number.");
    }
    // Log but don't crash the app for other registry errors
    console.warn("Registry insert failed:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Recover a session after localStorage was cleared.
// The caller should have already completed a WebAuthn discoverable
// authentication and extracted the keyId from the response.
// Returns null if the keyId is not in the registry.
// ---------------------------------------------------------------------------
export async function recoverByKeyId(keyId: string): Promise<RegistryUser | null> {
  if (!SUPABASE_URL) return null;
  const { data, error } = await supabase
    .from("users")
    .select("key_id, contract_id, phone, name")
    .eq("key_id", keyId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    keyId:      data.key_id,
    contractId: data.contract_id,
    phone:      data.phone,
    name:       data.name,
  };
}

// ---------------------------------------------------------------------------
// Group names — shared across all users via Supabase
// ---------------------------------------------------------------------------

export async function saveGroupName(groupId: number, name: string): Promise<void> {
  if (!SUPABASE_URL) return;
  const { error } = await supabase
    .from("group_names")
    .upsert({ group_id: groupId, name }, { onConflict: "group_id" });
  if (error) console.warn("Group name save failed:", error.message);
}

export async function fetchGroupNames(): Promise<Record<number, string>> {
  if (!SUPABASE_URL) return {};
  const { data, error } = await supabase
    .from("group_names")
    .select("group_id, name");
  if (error || !data) return {};
  const map: Record<number, string> = {};
  for (const row of data) map[row.group_id] = row.name;
  return map;
}
