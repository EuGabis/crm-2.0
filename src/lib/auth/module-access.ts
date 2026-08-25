/**
 * Acesso efetivo a um módulo — a regra, num lugar só.
 *
 * ⚠️ Isto morava dentro de `db/team.ts`, que é `"use client"`: uma rota de API
 * não pode importar de lá sem arrastar Zustand e o cliente de browser junto. A
 * saída fácil seria copiar a regra na rota — e aí a ordem de resolução passaria
 * a existir em dois lugares, com tudo para divergirem na primeira mudança.
 * `db/team.ts` reexporta `canAccess` daqui, então a regra continua sendo uma.
 */

export type MemberRole = "admin" | "user";
export type ModulePermissions = Record<string, boolean>;

export interface AccessMember {
  role: MemberRole;
  permissions: ModulePermissions | null;
  departmentId: string | null;
}

export interface AccessDepartment {
  id: string;
  permissions: ModulePermissions | null;
}

/**
 * A ordem é a decidida com o Gabriel:
 * admin vê tudo → exceção individual → departamento → libera (legado dos
 * membros antigos, que têm `permissions` vazio e seguem vendo tudo).
 */
export function canAccess(
  moduleKey: string,
  member: AccessMember | null,
  departments: AccessDepartment[]
): boolean {
  if (!member) return true;
  if (member.role === "admin") return true;
  const own = member.permissions?.[moduleKey];
  if (typeof own === "boolean") return own;
  const dep = departments.find((d) => d.id === member.departmentId);
  const fromDep = dep?.permissions?.[moduleKey];
  if (typeof fromDep === "boolean") return fromDep;
  return true;
}
