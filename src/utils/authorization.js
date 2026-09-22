export function hasAdminRole(user) {
  return user?.app_metadata?.role === 'admin';
}
