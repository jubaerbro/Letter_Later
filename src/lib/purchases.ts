import { Linking, Platform } from 'react-native';
import { syncEntitlement } from './api';
import { config } from './config';

/**
 * Google Play Billing via RevenueCat. The app never decides on its own that someone is
 * premium: after a purchase or restore it asks the server, which verifies with RevenueCat
 * (and RevenueCat with Google Play) using secret keys the app does not have.
 */
type PurchasesModule = typeof import('react-native-purchases').default;
type PurchasesPackage = import('react-native-purchases').PurchasesPackage;

let configuredFor: string | null = null;

function sdk(): PurchasesModule | null {
  if (Platform.OS !== 'android' || !config.revenueCatAndroidKey) return null;
  // Loaded lazily so the web build never touches the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-purchases').default as PurchasesModule;
}

export const purchasesAvailable = () => sdk() !== null;

export async function configurePurchases(userId: string) {
  const Purchases = sdk();
  if (!Purchases) return;
  if (configuredFor === null) {
    Purchases.configure({ apiKey: config.revenueCatAndroidKey, appUserID: userId });
  } else if (configuredFor !== userId) {
    await Purchases.logIn(userId);
  }
  configuredFor = userId;
}

export async function resetPurchasesUser() {
  const Purchases = sdk();
  if (Purchases && configuredFor) await Purchases.logOut().catch(() => {});
  configuredFor = null;
}

export interface PlanOption {
  id: string;
  title: string;
  price: string;
  period: string;
  pkg: PurchasesPackage;
}

export async function loadPlans(): Promise<PlanOption[]> {
  const Purchases = sdk();
  if (!Purchases) return [];
  const offerings = await Purchases.getOfferings();
  return (offerings.current?.availablePackages ?? []).map((pkg) => ({
    id: pkg.identifier,
    title: pkg.packageType === 'ANNUAL' ? 'Yearly' : pkg.packageType === 'MONTHLY' ? 'Monthly' : pkg.product.title,
    price: pkg.product.priceString,
    period: pkg.packageType === 'ANNUAL' ? 'per year' : pkg.packageType === 'MONTHLY' ? 'per month' : '',
    pkg,
  }));
}

/** Returns the server-verified premium state after purchase. */
export async function purchase(plan: PlanOption): Promise<boolean> {
  const Purchases = sdk();
  if (!Purchases) return false;
  await Purchases.purchasePackage(plan.pkg);
  return (await syncEntitlement()).premium;
}

export async function restore(): Promise<boolean> {
  const Purchases = sdk();
  if (!Purchases) return false;
  await Purchases.restorePurchases();
  return (await syncEntitlement()).premium;
}

/** Google Play requires an easy way to manage/cancel subscriptions. */
export function openManageSubscriptions() {
  return Linking.openURL('https://play.google.com/store/account/subscriptions');
}

export function isUserCancelled(error: unknown) {
  return (error as { userCancelled?: boolean })?.userCancelled === true;
}
