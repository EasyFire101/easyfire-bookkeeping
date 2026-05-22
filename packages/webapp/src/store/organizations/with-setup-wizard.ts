import { connect, MapStateToProps } from 'react-redux';
import { ApplicationState } from '@/store/reducers';

interface SetupWizardOwnProps {
  isOrganizationSetupCompleted: boolean;
  isOrganizationReady: boolean;
  isSubscriptionActive: boolean;
  isOrganizationBuildRunning: boolean;
}

export interface WithSetupWizardProps {
  isCongratsStep: boolean;
  isSubscriptionStep: boolean;
  isInitializingStep: boolean;
  isOrganizationStep: boolean;
  setupStepId: string | undefined;
  setupStepIndex: number;
}

type MapState<Props> = (
  mapped: WithSetupWizardProps,
  state: ApplicationState,
  props: Props,
) => Partial<WithSetupWizardProps> | Record<string, unknown>;

export function withSetupWizard<Props = SetupWizardOwnProps>(
  mapState?: MapState<Props & SetupWizardOwnProps>,
) {
  const mapStateToProps: MapStateToProps<
    WithSetupWizardProps,
    Props & SetupWizardOwnProps,
    ApplicationState
  > = (state, props) => {
    const {
      isOrganizationSetupCompleted,
      isOrganizationReady,
      isSubscriptionActive,
      isOrganizationBuildRunning,
    } = props;

    const condits = {
      isCongratsStep: isOrganizationSetupCompleted,
      isSubscriptionStep: !isSubscriptionActive,
      isInitializingStep: isOrganizationBuildRunning,
      isOrganizationStep: !isOrganizationReady && !isOrganizationBuildRunning,
    };
    const scenarios: Array<{ condition: boolean; step: string }> = [
      { condition: condits.isSubscriptionStep, step: 'subscription' },
      { condition: condits.isOrganizationStep, step: 'organization' },
      { condition: condits.isInitializingStep, step: 'initializing' },
      { condition: condits.isCongratsStep, step: 'congrats' },
    ];
    const setupStep = scenarios.find((scenario) => scenario.condition);
    const mapped: WithSetupWizardProps = {
      ...condits,
      setupStepId: setupStep?.step,
      setupStepIndex: setupStep ? scenarios.indexOf(setupStep) : -1,
    };
    return mapState
      ? (mapState(mapped, state, props) as WithSetupWizardProps)
      : mapped;
  };
  return connect(mapStateToProps);
}
