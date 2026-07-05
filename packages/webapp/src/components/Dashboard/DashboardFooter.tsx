// @ts-nocheck
import React from 'react';
import { For } from '@/components';
import { getFooterLinks } from '@/constants/footerLinks';

function FooterLinkItem({ title, link }) {
  return (
    <div class="">
      <a href={link} target="_blank" rel="noopener noreferrer">
        {title}
      </a>
    </div>
  );
}

export default function DashboardFooter() {
  const footerLinks = getFooterLinks();

  return (
    <div class="dashboard__footer">
      <div class="footer-links">
        <For render={FooterLinkItem} of={footerLinks} />
      </div>
    </div>
  );
}
