// @ts-nocheck
import React from 'react';
import { SetupLeftSection } from './SetupLeftSection';
import { SetupRightSection } from './SetupRightSection';
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
