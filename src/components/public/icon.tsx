import {
  AirVent, Bath, BellRing, Car, CigaretteOff, CircleParking, Clock, Coffee, ConciergeBell, CupSoda, Flame, Laptop,
  MapPinned, Plane, Presentation, ShowerHead, Shirt, BrushCleaning, CheckCircle2, Sun, Trees, Tv, Users, UtensilsCrossed, Wallet, Wifi, Wine,
  type LucideIcon,
} from "lucide-react";

export const PUBLIC_ICON_NAMES = [
  "AirVent", "Bath", "BellRing", "Car", "CigaretteOff", "CircleParking", "Clock", "Coffee", "ConciergeBell", "CupSoda", "Flame", "Laptop",
  "MapPinned", "Plane", "Presentation", "ShowerHead", "Shirt", "BrushCleaning", "Sun", "Trees", "Tv", "Users", "UtensilsCrossed", "Wallet", "Wifi", "Wine",
] as const;

const ICONS: Record<string, LucideIcon> = {
  AirVent, Bath, BellRing, Car, CigaretteOff, CircleParking, Clock, Coffee, ConciergeBell, CupSoda, Flame, Laptop,
  MapPinned, Plane, Presentation, ShowerHead, Shirt, BrushCleaning, Sparkles: BrushCleaning /* older saved services */, Sun, Trees, Tv, Users, UtensilsCrossed, Wallet, Wifi, Wine,
};

/** Render a lucide icon by name (names stored in the DB / site config). */
export function NamedIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = (name && ICONS[name]) || CheckCircle2;
  return <Icon className={className} aria-hidden="true" strokeWidth={1.4} />;
}
