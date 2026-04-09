import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useGlobalStore } from "@/business/store/globalStore";
import IntroView from "@/presentation/views/IntroView";
import OnboardingForm from "@/presentation/views/OnboardingForm";
import MapView from "@/presentation/views/MapView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const HomeRouter = () => {
  const authState = useGlobalStore((s) => s.authState);

  switch (authState) {
    case "authenticated_onboarded":
      return <MapView />;
    case "authenticated_no_onboarding":
      return <OnboardingForm />;
    case "unauthenticated":
    default:
      return <IntroView />;
  }
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRouter />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
