import { TaxRateDetailsDrawer } from '@/containers/TaxRates/drawers/TaxRateDetailsDrawer/TaxRateDetailsDrawer';
import { DRAWERS } from '@/constants/drawers';

export function TaxRatesLandingDrawers() {
  return (
    <>
      <TaxRateDetailsDrawer name={DRAWERS.TAX_RATE_DETAILS} />
    </>
  );
}
