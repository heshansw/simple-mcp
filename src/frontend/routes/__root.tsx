import { Link, Outlet } from "@tanstack/react-router";
import { APP_DISPLAY_NAME } from "@shared/mcp-client.js";

export function Root() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
        backgroundColor: "#f9fafb",
      }}
    >
      {/* Sidebar */}
      <nav
        style={{
          width: "250px",
          backgroundColor: "#1f2937",
          color: "#fff",
          padding: "2rem 0",
          position: "fixed",
          height: "100vh",
          overflow: "auto",
        }}
      >
        <div style={{ padding: "0 1.5rem", marginBottom: "2rem" }}>
          <h1 style={{ margin: "0", fontSize: "1.25rem", fontWeight: "700" }}>
            {APP_DISPLAY_NAME}
          </h1>
          <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem", opacity: 0.8 }}>
            Admin Panel
          </p>
        </div>

        <ul
          style={{
            listStyle: "none",
            margin: "0",
            padding: "0",
          }}
        >
          <NavLink to="/">Dashboard</NavLink>

          <NavSection label="Orchestration" />
          <NavLink to="/task-progress">Task Progress</NavLink>
          <NavLink to="/agent-executions">Executions</NavLink>
          <NavLink to="/agents">Agents</NavLink>

          <NavSection label="Development" />
          <NavLink to="/my-prs">My PRs</NavLink>
          <NavLink to="/reviews">Review Insights</NavLink>
          <NavLink to="/local-repos">Local Repos</NavLink>

          <NavSection label="Integrations" />
          <NavLink to="/connections">Connections</NavLink>
          <NavLink to="/confluence">Confluence</NavLink>
          <NavLink to="/databases">Databases</NavLink>

          <NavSection label="System" />
          <NavLink to="/settings">Settings</NavLink>
        </ul>
      </nav>

      {/* Main Content */}
      <div style={{ marginLeft: "250px", flex: 1 }}>
        {/* Header */}
        <header
          style={{
            backgroundColor: "#fff",
            borderBottom: "1px solid #e5e7eb",
            padding: "1rem 2rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: "0", fontSize: "1.5rem", fontWeight: "600" }}>
            Management Panel
          </h2>
          <div style={{ fontSize: "0.875rem", color: "#666" }}>
            Version 1.0.0
          </div>
        </header>

        {/* Main Content Area */}
        <main style={{ padding: "2rem" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

type NavSectionProps = {
  label: string;
};

function NavSection({ label }: NavSectionProps) {
  return (
    <li
      style={{
        padding: "1rem 1.5rem 0.375rem 1.5rem",
        fontSize: "0.6875rem",
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "#9ca3af",
        userSelect: "none",
      }}
    >
      {label}
    </li>
  );
}

type NavLinkProps = {
  to: string;
  children: string;
};

function NavLink({ to, children }: NavLinkProps) {
  return (
    <li>
      <Link
        to={to}
        activeProps={{
          style: {
            backgroundColor: "#374151",
          },
        }}
        style={{
          display: "block",
          padding: "0.625rem 1.5rem",
          color: "#fff",
          textDecoration: "none",
          fontSize: "0.8125rem",
          transition: "background-color 0.2s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
            "#374151";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
            "transparent";
        }}
      >
        {children}
      </Link>
    </li>
  );
}
