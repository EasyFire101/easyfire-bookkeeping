// @ts-nocheck
import { Classes } from '@blueprintjs/core';
import { StripeIntegrationEditBoot } from './StripeIntegrationEditBoot';
import { StripeIntegrationEditForm } from './StripeIntegrationEditForm';
import {
  StripeIntegrationEditFormContent,
  StripeIntegrationEditFormFooter,
} from './StripeIntegrationEditFormContent';
import { DrawerBody, DrawerHeaderContent } from '@/components';

export function StripeIntegrationEditContent() {
  return (
    <>
      <DrawerHeaderContent title={'Edit Stripe Integration'} />

      <StripeIntegrationEditBoot>
        <StripeIntegrationEditForm>
          <DrawerBody>
            <StripeIntegrationEditFormContent />
          </DrawerBody>

          <div className={Classes.DRAWER_FOOTER}>
            <StripeIntegrationEditFormFooter />
          </div>
        </StripeIntegrationEditForm>
      </StripeIntegrationEditBoot>
    </>
  );
}
