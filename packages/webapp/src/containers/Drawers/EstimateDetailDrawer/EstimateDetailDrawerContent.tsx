import { DrawerBody } from '@/components';
import { EstimateDetail } from './EstimateDetail';
import { EstimateDetailDrawerProvider } from './EstimateDetailDrawerProvider';

interface EstimateDetailDrawerContentProps {
  estimateId: number | undefined;
}

/**
 * Estimate detail drawer content.
 */
export function EstimateDetailDrawerContent({
  estimateId,
}: EstimateDetailDrawerContentProps) {
  return (
    <EstimateDetailDrawerProvider estimateId={estimateId}>
      <DrawerBody>
        <EstimateDetail />
      </DrawerBody>
    </EstimateDetailDrawerProvider>
  );
}
