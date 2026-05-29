import { isEmpty } from 'lodash';
import { useAbilityContext } from '@/hooks';

interface FinancialReport {
  ability: string;
  subject: string;
  [key: string]: unknown;
}

interface FinancialSection {
  sectionTitle: string;
  reports: FinancialReport[];
}

export function useFilterFinancialReports(financialSection: FinancialSection[]) {
  const ability = useAbilityContext();

  const section = financialSection
    .map((section) => {
      const reports = section.reports.filter((report) => {
        return ability.can(report.ability, report.subject);
      });

      return {
        sectionTitle: section.sectionTitle,
        reports,
      };
    })
    .filter(({ reports }) => !isEmpty(reports));

  return section;
}

