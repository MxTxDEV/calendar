import { Briefcase, BookOpen, Car, Coffee, Dumbbell, FolderKanban, GraduationCap, HeartPulse, House, Music, Plane, ShoppingCart, Star, Tag, User, Wallet, type LucideIcon } from 'lucide-react';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase, user: User, wallet: Wallet, 'heart-pulse': HeartPulse, 'graduation-cap': GraduationCap,
  'folder-kanban': FolderKanban, home: House, tag: Tag, plane: Plane, book: BookOpen, dumbbell: Dumbbell,
  cart: ShoppingCart, car: Car, star: Star, coffee: Coffee, music: Music,
};
export const CATEGORY_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899', '#64748b', '#84cc16', '#f97316'];

export function CategoryIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = CATEGORY_ICONS[name] ?? Tag;
  return <Icon size={size} />;
}
