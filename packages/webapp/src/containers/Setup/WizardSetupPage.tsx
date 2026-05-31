// @ts-nocheck
import React from 'react';
import { SetupRightSection } from './SetupRightSection';
import { SetupLeftSection } from './SetupLeftSection';
import EnsureOrganizationIsNotReady from '@/components/Guards/EnsureOrganizationIsNotReady';

import '@/style/pages/Setup/SetupPage.scss';

export function WizardSetupPage() {
  return (
    <EnsureOrganizationIsNotReady>
      <div class="setup-page">
        <SetupLeftSection />
        <SetupRightSection />
      </div>
    </EnsureOrganizationIsNotReady>
  );
}
