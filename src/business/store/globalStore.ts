import { create } from 'zustand';

export interface UserProfile {
  userId: string;
  userKey: string;
  home: { lat: number; lng: number } | null;
  work: { lat: number; lng: number } | null;
  commuteTime: string | null;
}

export interface CctvNode {
  id: string;
  lat: number;
  lng: number;
  name: string;
  cctvurl: string;
}

export interface WeatherAlert {
  district: string;
  hasAlert: boolean;
  alertType: string;
  alertLevel: string;
  message: string;
}

export interface RouteData {
  polyline: string;
  districts: string[];
  cctvNodes: CctvNode[];
}

export type AuthState = 'unauthenticated' | 'authenticated_no_onboarding' | 'authenticated_onboarded';

interface GlobalState {
  authState: AuthState;
  user: UserProfile | null;
  route: RouteData | null;
  weatherAlerts: WeatherAlert[];
  hazardNodes: CctvNode[];
  isLoading: boolean;

  setAuthState: (state: AuthState) => void;
  setUser: (user: UserProfile | null) => void;
  setRoute: (route: RouteData | null) => void;
  setWeatherAlerts: (alerts: WeatherAlert[]) => void;
  setHazardNodes: (nodes: CctvNode[]) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

const initialState = {
  authState: 'unauthenticated' as AuthState,
  user: null,
  route: null,
  weatherAlerts: [],
  hazardNodes: [],
  isLoading: false,
};

export const useGlobalStore = create<GlobalState>((set) => ({
  ...initialState,
  setAuthState: (authState) => set({ authState }),
  setUser: (user) => set({ user }),
  setRoute: (route) => set({ route }),
  setWeatherAlerts: (alerts) => set({ weatherAlerts: alerts }),
  setHazardNodes: (nodes) => set({ hazardNodes: nodes }),
  setLoading: (loading) => set({ isLoading: loading }),
  reset: () => set(initialState),
}));
