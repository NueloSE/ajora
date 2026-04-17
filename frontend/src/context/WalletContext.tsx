"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import {
  getSession, clearSession, formatPhone,
  registerWithPasskey, signInWithPasskey,
  primePasskeyKit,
  type AjoraSession,
} from "@/lib/passkey";

interface AuthState {
  session:  AjoraSession | null;
  loading:  boolean;
  signUp:   (phone: string, name: string) => Promise<void>;
  signIn:   (phone: string) => Promise<void>;
  signOut:  () => void;
}

const AuthContext = createContext<AuthState>({
  session:  null,
  loading:  true,
  signUp:   async () => {},
  signIn:   async () => {},
  signOut:  () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AjoraSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getSession();
    setSession(s);
    // If there's a valid session, prime the kit in the background so the first
    // transaction doesn't need to re-initialise from scratch.
    if (s) {
      primePasskeyKit(s.contractId, s.keyIdBase64).catch(() => {});
    }
    setLoading(false);
  }, []);

  const signUp = useCallback(async (phone: string, name: string) => {
    const s = await registerWithPasskey(phone, name);
    setSession(s);
  }, []);

  const signIn = useCallback(async (phone: string) => {
    const s = await signInWithPasskey(phone);
    setSession(s);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useWallet() {
  const { session, loading, signUp, signIn, signOut } = useContext(AuthContext);

  return {
    // contractId is the C... Stellar Smart Wallet address
    address:     session?.contractId ?? null,
    contractId:  session?.contractId ?? null,
    keyId:       session?.keyIdBase64 ?? null,
    phone:       session?.phone ?? null,
    name:        session?.name ?? null,
    displayName: session?.name || (session ? formatPhone(session.phone) : null),
    connected:   !!session,
    loading,
    signUp,
    signIn,
    signOut,
    connect:    () => {},
    disconnect: signOut,
  };
}
