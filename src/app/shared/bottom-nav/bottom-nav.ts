import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.html',
  styleUrl: './bottom-nav.css',
})
export class BottomNav {
  readonly items: NavItem[] = [
    { path: '/home', label: 'Home', icon: '🏠' },
    { path: '/browse', label: 'Browse', icon: '🔎' },
    { path: '/stats', label: 'Stats', icon: '📊' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
  ];
}
