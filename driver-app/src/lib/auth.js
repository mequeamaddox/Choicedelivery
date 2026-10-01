// Who's signed in. Only driver accounts can use the app; everyone else is pointed to the website.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, saveToken, getToken, onUnauthorized } from './client';
import { stopTracking } from './tracking';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const NOT_A_DRIVER = 'This app is for drivers. Shippers and dispatch sign in at app.choicedeliverysc.com.';

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null });

  // Signs out right away; going offline on the server happens in the background so a weak
  // signal can't leave the button looking stuck.
  const signOut = useCallback(async ({ goOffline = true } = {}) => {
    const token = goOffline ? await getToken().catch(() => null) : null;
    await saveToken(null).catch(() => {});
    setState({ loading: false, user: null });
    stopTracking().catch(() => {});
    if (token) api.setOnline(false, { token, timeoutMs: 10000 }).catch(() => {});
  }, []);

  useEffect(() => {
    onUnauthorized(() => signOut({ goOffline: false }));
    (async () => {
      if (!(await getToken())) return setState({ loading: false, user: null });
      try {
        const user = await api.me();
        if (user.role !== 'driver') throw new Error(NOT_A_DRIVER);
        setState({ loading: false, user });
      } catch (e) {
        // Offline at launch: keep the saved login and let screens retry.
        if (e.status === 0) setState({ loading: false, user: { offline: true } });
        else { await saveToken(null); setState({ loading: false, user: null }); }
      }
    })();
  }, [signOut]);

  const signIn = useCallback(async (email, password) => {
    const { token, user } = await api.login(email.trim(), password);
    if (user.role !== 'driver') throw new Error(NOT_A_DRIVER);
    await saveToken(token);
    setState({ loading: false, user });
  }, []);

  const signUp = useCallback(async (fields) => {
    const { token, user } = await api.driverSignup(fields);
    await saveToken(token);
    setState({ loading: false, user });
  }, []);

  const refresh = useCallback(async () => {
    const user = await api.me();
    setState({ loading: false, user });
    return user;
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signOut, refresh, setUser: (user) => setState({ loading: false, user }) }}>
      {children}
    </AuthContext.Provider>
  );
}
