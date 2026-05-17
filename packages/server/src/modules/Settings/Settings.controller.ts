import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SettingsApplicationService } from './SettingsApplication.service';
import { ISettingsDTO, PreferencesAction } from './Settings.types';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';

@Controller('settings')
@ApiTags('Settings')
@UseGuards(AuthorizationGuard, PermissionGuard)
export class SettingsController {
  constructor(
    private readonly settingsApplicationService: SettingsApplicationService,
  ) {}

  @Put()
  @RequirePermission(PreferencesAction.Mutate, AbilitySubject.Preferences)
  @ApiOperation({ summary: 'Save the given settings.' })
  async saveSettings(@Body() settingsDTO: ISettingsDTO) {
    return this.settingsApplicationService.saveSettings(settingsDTO);
  }

  @Get()
  @ApiOperation({ summary: 'Retrieves the settings.' })
  async getSettings() {
    return this.settingsApplicationService.getSettings();
  }
}
