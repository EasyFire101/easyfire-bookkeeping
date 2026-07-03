import { CommercialDocFooter, If, DetailsMenu, DetailItem } from '@/components';
import { useVendorCreditDetailDrawerContext } from './VendorCreditDetailDrawerProvider';
import intl from 'react-intl-universal';

export function VendorCreditDetailFooter() {
  const { vendorCredit } = useVendorCreditDetailDrawerContext();

  if (!vendorCredit) {
    return null;
  }

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'150px'}>
        <If condition={!!vendorCredit.note}>
          <DetailItem
            label={intl.get('note')}
            children={vendorCredit.note}
            multiline
          />
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
