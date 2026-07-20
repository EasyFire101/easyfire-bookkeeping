// @ts-nocheck
import intl from 'react-intl-universal';
import { EASYFIRE_SOURCE_URL } from './legal';

export const getFooterLinks = () => [
  {
    title: intl.get('blog'),
    link: 'https://docs.bigcapital.ly/blog',
  },
  {
    title: intl.get('community'),
    link: 'https://discord.com/invite/c8nPBJafeb',
  },
  {
    title: intl.get('support'),
    link: 'https://discord.com/invite/c8nPBJafeb',
  },
  {
    title: intl.get('docs'),
    link: 'https://docs.bigcapital.ly',
  },
  {
    title: 'Bigcapital',
    link: 'http://bigcapital.ly',
  },
  {
    title: 'Source Code (AGPLv3)',
    link: EASYFIRE_SOURCE_URL,
  },
];
