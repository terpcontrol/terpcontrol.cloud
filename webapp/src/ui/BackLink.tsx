import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import ui from './ui.module.css';

/** The chevron back to where a page was opened from, named for anybody who cannot see it. */
export function BackLink({ to, label, className }: { to: string; label: string; className?: string }) {
  return (
    <Link to={to} className={className ? `${ui.back} ${className}` : ui.back} aria-label={label}>
      <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
    </Link>
  );
}
