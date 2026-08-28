import { SetupWizardComponent } from './setup-wizard.component';

// The wizard decides its own length from the hardware report, and a wrong
// decision silently takes the grow stage away from a device that can use it.
describe('SetupWizardComponent step list', () => {
  const wizardFor = (device_type: string, sockets?: string): SetupWizardComponent => {
    const component = new SetupWizardComponent(null as any, null as any, null as any);
    component.device = { device_id: 'd', device_type: device_type } as any;
    component.hardwareInfo = sockets === undefined ? {} : { sockets: sockets };
    return component;
  };

  it('asks a fridge for stage and plan, and never about sockets', () => {
    expect(wizardFor('fridge').steps).toEqual(['name', 'stage', 'plan', 'done']);
  });

  it('gives a controller that regulates the climate every step', () => {
    expect(wizardFor('controller', 'heater,light').steps).toEqual(['name', 'connections', 'stage', 'plan', 'done']);
  });

  it('gives a controller that only switches the light every step', () => {
    expect(wizardFor('controller', 'light').steps).toEqual(['name', 'connections', 'stage', 'plan', 'done']);
  });

  it('stops after the connections for a controller that says it has no sockets', () => {
    expect(wizardFor('controller', 'none').steps).toEqual(['name', 'connections', 'done']);
  });

  it('keeps every step for a controller that has not reported its sockets yet', () => {
    const wizard = wizardFor('controller');
    expect(wizard.steps).toEqual(['name', 'connections', 'stage', 'plan', 'done']);
    // Still worded carefully: not knowing is described like monitoring, but it
    // is not a reason to withhold the stage.
    expect(wizard.isMonitor).toBe(true);
  });

  it('offers stage and plan to a monitoring controller when it was opened for that', () => {
    const wizard = wizardFor('controller', 'none');
    wizard.startAt = 'stage';
    expect(wizard.steps).toEqual(['name', 'connections', 'stage', 'plan', 'done']);
  });

  it('only asks a device that is no climate device for its name', () => {
    expect(wizardFor('plug').steps).toEqual(['name', 'done']);
  });
});
