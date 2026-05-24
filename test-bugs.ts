// Intentional bugs for testing claude-code-review action

interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
}

// Bug 1: SQL injection — string interpolation in query
async function findUserByName(db: any, name: string) {
  const result = await db.query(`SELECT * FROM users WHERE name = '${name}'`);
  return result.rows[0];
}

// Bug 2: null dereference — getUser can return undefined
function getUserDisplayName(users: Map<number, User>, id: number): string {
  const user = users.get(id);
  return user.name.toUpperCase();
}

// Bug 3: swallowed error — catch block silently drops failures
async function syncData(fetchRemote: () => Promise<void>, cache: string[]) {
  try {
    await fetchRemote();
  } catch (e) {}
  return cache;
}

// Bug 4: inverted access check — grants access to non-admins
function canDeleteUser(actor: User): boolean {
  if (actor.role !== "admin") {
    return true;
  }
  return false;
}

// Bug 5: secret in log — logs API token in plaintext
function authenticate(token: string): boolean {
  console.log(`Authenticating with token: ${token}`);
  return token.length > 0;
}

// Bug 6: off-by-one — skips last element
function sumArray(arr: number[]): number {
  let total = 0;
  for (let i = 0; i < arr.length - 1; i++) {
    total += arr[i];
  }
  return total;
}
