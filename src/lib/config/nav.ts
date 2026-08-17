import {
  LayoutDashboard,
  MessageSquare,
  CalendarDays,
  Users,
  KanbanSquare,
  CreditCard,
  Sparkles,
  Bot,
  Megaphone,
  Workflow,
  Globe,
  GraduationCap,
  HardDrive,
  Star,
  BarChart3,
  Puzzle,
  MessageCircle,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /** Chave usada nas permissões por módulo (location_members.permissions). */
  key: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Painel de controle", icon: LayoutDashboard, key: "dashboard" },
  { href: "/conversas", label: "Conversas", icon: MessageSquare, key: "conversas" },
  { href: "/calendarios", label: "Calendários", icon: CalendarDays, key: "calendarios" },
  { href: "/contatos", label: "Contatos", icon: Users, key: "contatos" },
  { href: "/leads", label: "Leads", icon: KanbanSquare, key: "leads" },
  { href: "/pagamentos", label: "Pagamentos", icon: CreditCard, key: "pagamentos" },
  { href: "/ai-studio", label: "AI Studio", icon: Sparkles, badge: "Beta", key: "ai-studio" },
  { href: "/agentes-ia", label: "Agentes de IA", icon: Bot, key: "agentes-ia" },
  { href: "/marketing", label: "Marketing", icon: Megaphone, key: "marketing" },
  { href: "/automacoes", label: "Automações", icon: Workflow, key: "automacoes" },
  { href: "/sites", label: "Sites", icon: Globe, key: "sites" },
  { href: "/assinaturas", label: "Assinaturas", icon: GraduationCap, key: "assinaturas" },
  { href: "/midia", label: "Mídia Drive", icon: HardDrive, key: "midia" },
  { href: "/reputacao", label: "Reputação", icon: Star, key: "reputacao" },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, key: "relatorios" },
  { href: "/marketplace", label: "Marketplace", icon: Puzzle, key: "marketplace" },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, key: "whatsapp" },
];

/** Módulos que podem ser ligados/desligados por usuário na tela de Equipe. */
export const PERMISSION_MODULES = NAV_ITEMS.map((i) => ({
  key: i.key,
  label: i.label,
}));

export const SETTINGS_ITEM: NavItem = {
  href: "/configuracoes",
  label: "Configurações",
  icon: Settings,
  key: "configuracoes",
};
