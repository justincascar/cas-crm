/**
 * Demonstration staff — same four people already used as claim handlers.
 * Fictional passwords are listed for Justin in docs/AUTH-NOTES.md.
 * They can be overridden with CAS_DEMO_PASSWORD_<USERNAME> in .env.local (not committed).
 */
export const DEMO_STAFF = [
  {
    id: "staff-justin",
    username: "justin",
    name: "Justin Roberts",
    email: "justin@completeaccidentsolutions.example",
    role: "md",
  },
  {
    id: "staff-sian",
    username: "sian",
    name: "Sian Evans",
    email: "sian.evans@completeaccidentsolutions.example",
    role: "handler",
  },
  {
    id: "staff-tom",
    username: "tom",
    name: "Tom Hughes",
    email: "tom.hughes@completeaccidentsolutions.example",
    role: "handler",
  },
  {
    id: "staff-megan",
    username: "megan",
    name: "Megan Price",
    email: "megan.price@completeaccidentsolutions.example",
    role: "handler",
  },
] as const;

export type DemoStaffId = (typeof DEMO_STAFF)[number]["id"];

function titleCaseUsername(username: string): string {
  return username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
}

export function demoPasswordFor(username: string): string {
  const envName = `CAS_DEMO_PASSWORD_${username.toUpperCase()}`;
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;
  return `CasDemo.${titleCaseUsername(username)}`;
}
