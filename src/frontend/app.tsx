import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RootRoute,
  Route,
  Router,
  RouterProvider,
} from "@tanstack/react-router";
import { Root } from "@frontend/routes/__root";
import { DashboardPage } from "@frontend/routes/index";
import { ConnectionsListPage } from "@frontend/routes/connections/index";
import { NewConnectionPage } from "@frontend/routes/connections/new";
import { ConnectionDetailPage } from "@frontend/routes/connections/$connectionId";
import { AgentsListPage } from "@frontend/routes/agents/index";
import { AgentDetailPage } from "@frontend/routes/agents/$agentId";
import { SettingsPage } from "@frontend/routes/settings/index";
import { MyPRsPage } from "@frontend/routes/my-prs/index";
import { ReviewsPage } from "@frontend/routes/reviews/index";
import { LocalReposPage } from "@frontend/routes/local-repos/index";
import { ConfluencePage } from "@frontend/routes/confluence/index";
import { DatabasesPage } from "@frontend/routes/databases/index";
import { useState } from "react";

// Create root route
const rootRoute = new RootRoute({
  component: Root,
});

// Dashboard route
const dashboardRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

// Connections routes
const connectionsIndexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/connections",
  component: ConnectionsListPage,
});

const newConnectionRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/connections/new",
  component: NewConnectionPage,
});

const connectionDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/connections/$connectionId",
  component: ConnectionDetailPage,
});

// Agents routes
const agentsIndexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsListPage,
});

const agentDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/agents/$agentId",
  component: AgentDetailPage,
});

// Local Repos route
const localReposRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/local-repos",
  component: LocalReposPage,
});

// Confluence route
const confluenceRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/confluence",
  component: ConfluencePage,
});

// Databases route
const databasesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/databases",
  component: DatabasesPage,
});

// Settings route
const settingsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

// My PRs route
const myPrsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/my-prs",
  component: MyPRsPage,
});

// Reviews route
const reviewsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/reviews",
  component: ReviewsPage,
});

// Build route tree
const routeTree = rootRoute.addChildren([
  dashboardRoute,
  myPrsRoute,
  reviewsRoute,
  connectionsIndexRoute,
  newConnectionRoute,
  connectionDetailRoute,
  agentsIndexRoute,
  agentDetailRoute,
  localReposRoute,
  confluenceRoute,
  databasesRoute,
  settingsRoute,
]);

// Create router
const router = new Router({ routeTree });

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

export function App() {
  // State management could be added here if needed
  const [initialized] = useState(true);

  if (!initialized) {
    return <div>Initializing...</div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
