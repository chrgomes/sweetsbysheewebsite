/**
 * Role-based access control. Every protected Server Action, page and route
 * checks a permission on the server (`requireAdmin(permission)`); hiding
 * navigation items is only a convenience.
 */
export const ROLES = ["owner", "admin", "order_manager", "production", "reporting"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrator",
  order_manager: "Order manager",
  production: "Production staff",
  reporting: "Read-only / reporting",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Everything, including team accounts.",
  admin: "Everything except managing team accounts.",
  order_manager: "Orders, payments, custom requests, quotes, customers and the calendar.",
  production: "View orders and the calendar; move orders through production.",
  reporting: "View orders, requests, the calendar and reports; export data. No changes.",
};

export const PERMISSIONS = [
  "dashboard:view",
  "orders:view",
  /** Move orders through production (confirmed → in production → ready → completed). */
  "orders:progress",
  /** Cancel, hold, edit notes. */
  "orders:manage",
  /** Record offline payments, send payment links. */
  "orders:payments",
  "orders:refund",
  "orders:export",
  "inquiries:view",
  "inquiries:manage",
  "quotes:manage",
  "calendar:view",
  "capacity:override",
  "products:view",
  "products:edit",
  "content:edit",
  "discounts:manage",
  "customers:view",
  "customers:erase",
  "reports:view",
  "settings:edit",
  "users:manage",
  "audit:view",
  "system:view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);
const without = (...p: Permission[]) => new Set<Permission>(PERMISSIONS.filter((x) => !p.includes(x)));

const GRANTS: Record<Role, Set<Permission>> = {
  owner: ALL,
  admin: without("users:manage"),
  order_manager: new Set<Permission>([
    "dashboard:view",
    "orders:view",
    "orders:progress",
    "orders:manage",
    "orders:payments",
    "orders:export",
    "inquiries:view",
    "inquiries:manage",
    "quotes:manage",
    "calendar:view",
    "products:view",
    "customers:view",
  ]),
  production: new Set<Permission>(["dashboard:view", "orders:view", "orders:progress", "inquiries:view", "calendar:view", "products:view"]),
  reporting: new Set<Permission>([
    "dashboard:view",
    "orders:view",
    "orders:export",
    "inquiries:view",
    "calendar:view",
    "products:view",
    "customers:view",
    "reports:view",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return [...(GRANTS[role] ?? [])];
}
