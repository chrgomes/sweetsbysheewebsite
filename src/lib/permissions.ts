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
  order_manager: "Orders, payments, custom requests, quotes, customers and the calendar; can see stock.",
  production: "View orders and the calendar; move orders through production; keep stock up to date.",
  reporting: "View orders, requests, the calendar, stock, costs and reports; export data. No changes.",
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
  /** See ingredients, stock levels and recipes (not costs). */
  "inventory:view",
  /** Record deliveries, stocktakes and waste; edit ingredients, suppliers and recipes. */
  "inventory:manage",
  /** Ingredient costs, recipe costs and margins. */
  "costs:view",
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
    "inventory:view",
  ]),
  production: new Set<Permission>(["dashboard:view", "orders:view", "orders:progress", "inquiries:view", "calendar:view", "products:view", "inventory:view", "inventory:manage"]),
  reporting: new Set<Permission>([
    "dashboard:view",
    "orders:view",
    "orders:export",
    "inquiries:view",
    "calendar:view",
    "products:view",
    "customers:view",
    "reports:view",
    "inventory:view",
    "costs:view",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return [...(GRANTS[role] ?? [])];
}
