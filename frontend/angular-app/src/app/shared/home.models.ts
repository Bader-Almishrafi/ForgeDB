export interface AppNotification {
  id: string;
  title: string;
  description: string;
  projectName: string;
  occurredAt: string;
  read: boolean;
  route?: string | null;
}

export interface RecentActivity {
  id: string;
  title: string;
  description: string;
  projectName: string;
  occurredAt: string;
  route?: string | null;
}
