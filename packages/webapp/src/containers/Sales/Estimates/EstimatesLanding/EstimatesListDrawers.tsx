import { index as EstimateDetailDrawer } from '@/containers/Drawers/EstimateDetailDrawer';
import { EstimateSendMailDrawer } from '@/containers/Sales/Estimates/EstimateSendMailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function EstimatesListDrawers() {
  return (
    <>
      <EstimateDetailDrawer name={DRAWERS.ESTIMATE_DETAILS} />
      <EstimateSendMailDrawer name={DRAWERS.ESTIMATE_SEND_MAIL} />
    </>
  );
}
