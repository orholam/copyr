import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Landing from "./pages/Landing";
import AppShell from "./pages/app/Shell";
import Dashboard from "./pages/app/Dashboard";
import Assistant from "./pages/app/Assistant";
import Pipeline from "./pages/app/Pipeline";
import Inbox from "./pages/app/Inbox";
import Portfolio from "./pages/app/Portfolio";
import Analytics from "./pages/app/Analytics";
import CompanyDetail from "./pages/app/CompanyDetail";
import Settings from "./pages/app/Settings";
import Diligence from "./pages/app/Diligence";
import Automations from "./pages/app/Automations";
import CommandCenter from "./pages/app/CommandCenter";
import { SignIn, SignUp, PasswordReset, UpdatePassword } from "./pages/auth";
import PublicIntakeForm from "./pages/PublicIntakeForm";
import { ShareRedirect } from "./pages/PublicIntakeForm";
import {
  BlogIndex,
  BlogPost,
  ChangelogIndex,
  PrivacyPolicy,
  TermsOfService,
  CookiePolicy,
  About,
} from "./pages/site";
import { AuthProvider, RequireAuth } from "./lib/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/about", element: <About /> },
  { path: "/public/forms/:slug", element: <PublicIntakeForm /> },
  { path: "/share/:token", element: <ShareRedirect /> },
  { path: "/blog", element: <BlogIndex /> },
  { path: "/blog/:slug", element: <BlogPost /> },
  { path: "/changelog", element: <ChangelogIndex /> },
  { path: "/privacy", element: <PrivacyPolicy /> },
  { path: "/terms", element: <TermsOfService /> },
  { path: "/cookies", element: <CookiePolicy /> },
  { path: "/privacy-policy", element: <PrivacyPolicy /> },
  { path: "/terms-of-service", element: <TermsOfService /> },
  { path: "/cookie-policy", element: <CookiePolicy /> },
  { path: "/auth/sign-in", element: <SignIn /> },
  { path: "/auth/sign-up", element: <SignUp /> },
  { path: "/auth/reset", element: <PasswordReset /> },
  { path: "/auth/password-reset", element: <PasswordReset /> },
  { path: "/auth/update-password", element: <UpdatePassword /> },
  {
    path: "/app",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Assistant /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "pipeline", element: <Pipeline /> },
      { path: "inbox", element: <Inbox /> },
      { path: "diligence", element: <Diligence /> },
      { path: "automations", element: <Automations /> },
      { path: "portfolio", element: <Portfolio /> },
      { path: "analytics", element: <Analytics /> },
      { path: "command-center", element: <CommandCenter /> },
      { path: "companies/:id", element: <CompanyDetail /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
