import { createContext, useContext } from "react";
import type { AccountSessionState } from "./useAccountSession";

export const AccountSessionContext = createContext<AccountSessionState>({
  status: "loading",
});

/** Состояние входа из ближайшего RequireAccount. */
export function useCurrentAccount(): AccountSessionState {
  return useContext(AccountSessionContext);
}
