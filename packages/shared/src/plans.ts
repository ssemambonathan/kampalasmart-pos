import { BusinessPlan, SubscriptionStatus } from './constants';

export interface PlanDefinition {
  id: BusinessPlan;
  name: string;
  description: string;
  maxLocations: number;
  maxUsers: number;
  features: {
    multiLocation: boolean;
    analytics: boolean;
    assistant: boolean;
    auditExport: boolean;
    advancedReports: boolean;
  };
}

export const PLANS: Record<BusinessPlan, PlanDefinition> = {
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    description: 'Single shop with core POS, inventory and sales reporting.',
    maxLocations: 1,
    maxUsers: 3,
    features: {
      multiLocation: false,
      analytics: true,
      assistant: false,
      auditExport: false,
      advancedReports: false,
    },
  },
  GROWTH: {
    id: 'GROWTH',
    name: 'Growth',
    description: 'Multi-branch retail operations with full analytics and offline sync.',
    maxLocations: 3,
    maxUsers: 15,
    features: {
      multiLocation: true,
      analytics: true,
      assistant: true,
      auditExport: true,
      advancedReports: true,
    },
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Unlimited branches and users with priority support.',
    maxLocations: Number.POSITIVE_INFINITY,
    maxUsers: Number.POSITIVE_INFINITY,
    features: {
      multiLocation: true,
      analytics: true,
      assistant: true,
      auditExport: true,
      advancedReports: true,
    },
  },
};

export const TRIAL_DAYS = 30;

export interface SubscriptionSnapshot {
  plan: BusinessPlan;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | Date | null;
  now?: Date;
}

export function isSubscriptionActive(snapshot: SubscriptionSnapshot): boolean {
  if (snapshot.subscriptionStatus === 'ACTIVE') return true;
  if (snapshot.subscriptionStatus === 'TRIAL') {
    if (!snapshot.trialEndsAt) return false;
    return new Date(snapshot.trialEndsAt).getTime() > (snapshot.now ?? new Date()).getTime();
  }
  return false;
}

export function planFor(plan: BusinessPlan): PlanDefinition {
  return PLANS[plan] ?? PLANS.STARTER;
}
