/**
 * Where a staff member lands after signing in, by permission (not role name,
 * so custom roles work): Admin → /admin, Manager → /manager, Reception →
 * /reception, waiters, the restaurant screen and the Mpishi → the Restaurant Portal (Live),
 * drivers → their trips.
 */
export function staffHome(permissions: ReadonlySet<string>): string {
  if (permissions.has("dashboard.admin")) return "/admin/dashboard";
  if (permissions.has("dashboard.manager") || permissions.has("dashboard.owner")) return "/manager/dashboard";
  if (permissions.has("dashboard.front_desk")) return "/reception/dashboard";
  // Waiters, the shared restaurant screen and the Mpishi: the Live board is Home (a waiter's shift is on it).
  if (permissions.has("restaurant.shift")) return "/staff/restaurant";
  if (permissions.has("restaurant.orders")) return "/staff/restaurant";
  if (permissions.has("kitchen.orders")) return "/staff/restaurant";
  if (permissions.has("transport.driver")) return "/staff/driver";
  return "/staff/account";
}
