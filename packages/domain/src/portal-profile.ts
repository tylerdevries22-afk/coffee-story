export type AppRole = 'client' | 'staff' | 'admin';

export type SetupStatus = 'not_started' | 'in_progress' | 'completed';

export type ClientSetupAnswers = {
  goals: string[];
  pressure: 'light' | 'medium' | 'bold';
  preferredTimes: string[];
};

export type StaffSetupAnswers = {
  specialties: string[];
  workingDays: string[];
};

export type AdminSetupAnswers = {
  businessName: string;
  openDays: string[];
  menuConfirmed: boolean;
  teamConfirmed: boolean;
  onlineOrdering: boolean;
};

export type RoleSetup<Answers> = {
  status: SetupStatus;
  step: number;
  answers: Answers;
};

/** Per-persona onboarding progress; mirrors the web portal's setup flow. */
export type PortalSetupState = {
  client: RoleSetup<ClientSetupAnswers>;
  staff: RoleSetup<StaffSetupAnswers>;
  admin: RoleSetup<AdminSetupAnswers>;
};

export type PortalProfile = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  birthday: string | null;
  avatarUrl: string | null;
};
