export type TenantTrainingProfile = {
  businessName: string;
  industry: string;
  locale: string;
  website?: string;
  products?: string[];
  services?: string[];
  complianceTopics?: string[];
  brandVoice?: string;
};

export type TrainingSource = { title: string; url: string; publisher: string; accessedAt: string };

export type TrainingQuizQuestion = {
  prompt: string;
  choices: string[];
  /** Present only inside the generation pipeline; stripped before publication. */
  correctChoice?: number;
  explanation: string;
};

export type TrainingLesson = {
  slug: string;
  title: string;
  objective: string;
  content: string;
  estimatedMinutes: number;
  /** Source URLs that directly support this lesson's operational claims. */
  sourceUrls: string[];
  media: { kind: 'image' | 'video'; url: string; title: string; rightsNote: string }[];
  quiz: TrainingQuizQuestion[];
};

export type TrainingModule = {
  slug: string;
  title: string;
  summary: string;
  icon: { symbol: string; prompt: string };
  lessons: TrainingLesson[];
};

export type TrainingManifest = {
  schemaVersion: 1;
  generatedAt: string;
  tenant: TenantTrainingProfile;
  sources: TrainingSource[];
  modules: TrainingModule[];
};
