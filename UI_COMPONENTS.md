# UI Component Structure & Design System
**Company Phone Tracker — Front-End UI/UX Specification**

## 1. Visual Design Language & Aesthetics
The front-end is crafted for enterprise reliability and speed:
- **Typography:** High-legibility system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`) with monospace accents for hardware identifiers (IMEI, NFC UID, Asset Tag).
- **Themes:** Dual-mode light and dark themes with seamless CSS custom properties (`--background`, `--foreground`, `--card-bg`, `--card-border`).
- **Color Palette:**
  - Primary Accent: Indigo (`#6366f1` / `#4f46e5`)
  - Success / Online: Emerald (`#10b981`)
  - Warning / Exceptions: Amber (`#f59e0b`)
  - Danger / Breaches: Rose/Red (`#ef4444`)
  - Dark Surface: Slate 950 (`#090d16`) with Slate 900 containers
  - Light Surface: Slate 50 (`#f8fafc`) with pure White containers

---

## 2. Component Hierarchy & Layout Tree

```
<RootLayout> (src/app/layout.tsx)
  └── <ThemeProvider> (src/components/theme-provider.tsx)
        ├── <LoginPage> (src/app/login/page.tsx) [Public / Guest]
        │     ├── <Suspense>
        │     │     └── <LoginForm>
        │     └── <DemoAccountSelector>
        │
        ├── <UnauthorizedPage> (src/app/unauthorized/page.tsx) [403 Forbidden]
        │
        └── <DashboardRootLayout> (src/app/(dashboard)/layout.tsx) [Authenticated Server Layout]
              └── <DashboardShell> (src/components/dashboard-shell.tsx)
                    ├── <Sidebar> (src/components/sidebar.tsx)
                    │     ├── BrandLogo
                    │     ├── NavigationSection: Overview
                    │     ├── NavigationSection: Assets & Identity
                    │     ├── NavigationSection: Custody Operations
                    │     ├── NavigationSection: Monitoring & Exceptions
                    │     ├── NavigationSection: Governance & Audit
                    │     ├── NavigationSection: Administration
                    │     │     └── [NavItems with dynamic RBAC Lock Badges]
                    │     └── PhaseBadge ("Phase 1 Foundation Active")
                    │
                    ├── <Header> (src/components/header.tsx)
                    │     ├── MobileMenuToggle (Hamburger button)
                    │     ├── GlobalSearchBar ("Search phones, NFC UID, employees...")
                    │     ├── SystemStatusIndicator ("System Online (PostgreSQL)")
                    │     ├── ThemeToggle (Sun / Moon)
                    │     ├── UserIdentityBlock (Name, Email, Role badge, Department)
                    │     └── LogoutButton
                    │
                    ├── <main> (Page content)
                    │     ├── <DashboardPage> (6 Metric Cards, 6 Operational Panels)
                    │     ├── <EmployeesPage>
                    │     ├── <NfcCardsPage>
                    │     ├── <PhonesPage>
                    │     ├── <AssignmentsPage>
                    │     ├── <NfcKioskPage>
                    │     ├── <CustodyOperationsPage>
                    │     ├── <ActiveCustodyPage>
                    │     ├── <OverduePage>
                    │     ├── <IncidentsPage>
                    │     ├── <ReportsPage>
                    │     ├── <AuditLogsPage>
                    │     ├── <UsersPage>
                    │     └── <SettingsPage>
                    │
                    └── <footer> ("Company Phone Tracker • PostgreSQL Active")
```

---

## 3. UI Primitives & Accessibility Standards

### `Card` (`src/components/ui/card.tsx`)
Container primitive providing subtle enterprise borders, rounded corners (`rounded-xl`), and dark mode contrast borders.
- Sub-components: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`.

### `EmptyState` (`src/components/empty-state.tsx`)
Accessible empty state component deployed when query counts return zero:
- Avoids fabricated mock numbers
- Clearly displays what real records belong in the space
- Provides contextual call-to-action button or navigation link

### `LoadingState` (`src/components/loading-state.tsx`)
Standardized animated spinner (`Loader2`) with customizable status messages for streaming or async fetches.

### `PlaceholderPage` (`src/components/placeholder-page.tsx`)
Uniform placeholder wrapper for route areas undergoing foundation preparation:
- Displays target phase badge (`Phase 1 Foundation`, `Phase 2`)
- Explicitly lists underlying active PostgreSQL tables
- Highlights planned operational scope
- Pulls live real database counts rather than hardcoded mock figures

---

## 4. Responsive Breakpoints

| Breakpoint | Target Devices | Layout Behavior |
|---|---|---|
| `< 640px` (`sm`) | Mobile phones | Collapsed drawer, stacked single-column metric cards, simplified table views. |
| `640px - 1024px` (`md/lg`) | Tablets / Wall-Mounted Kiosks | Touch-optimized tap targets, 2-column cards, collapsible sidebar overlay. |
| `> 1024px` (`lg/xl`) | Desktop & Laptop workstations | Permanent 72-unit left navigation sidebar, 6-column metric card grid, full data tables. |
