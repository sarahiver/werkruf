export function isAdminUser(user) {
  return user?.app_metadata?.role === 'admin';
}
