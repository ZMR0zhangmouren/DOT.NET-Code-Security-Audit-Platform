import { LogOut, Menu, Shield } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';

interface TopBarProps {
  onToggleSidebar: () => void;
}

export function TopBar({ onToggleSidebar }: TopBarProps): React.ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center gap-4 glass-surface px-4">
      <Button variant="ghost" size="icon" onClick={onToggleSidebar}>
        <Menu className="h-5 w-5" />
      </Button>

      <Link to="/" className="flex items-center gap-2 font-semibold text-sm">
        <Shield className="h-5 w-5 text-primary" />
        <span className="hidden sm:inline">CodeSec Audit</span>
      </Link>

      <div className="flex-1" />

      <ThemeToggle />

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {user.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{user.username}</p>
              <p className="text-xs text-muted-foreground">{user.role}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/me')}>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}
