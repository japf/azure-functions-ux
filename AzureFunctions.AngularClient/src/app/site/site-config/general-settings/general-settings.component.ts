import { Component, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { Subscription as RxSubscription } from 'rxjs/Subscription';
import { TranslateService } from '@ngx-translate/core';

import { Site } from 'app/shared/models/arm/site';
import { SiteConfig } from 'app/shared/models/arm/site-config';
import { AvailableStackNames, AvailableStack, MinorVersion, MajorVersion, Framework } from 'app/shared/models/arm/stacks';
import { DropDownComponent } from './../../../drop-down/drop-down.component';
import { DropDownElement } from './../../../shared/models/drop-down-element';
import { RadioSelectorComponent } from './../../../radio-selector/radio-selector.component';
import { SelectOption } from './../../../shared/models/select-option';

import { SaveResult } from './../site-config.component';
import { AiService } from './../../../shared/services/ai.service';
import { PortalResources } from './../../../shared/models/portal-resources';
import { BusyStateComponent } from './../../../busy-state/busy-state.component';
import { BusyStateScopeManager } from './../../../busy-state/busy-state-scope-manager';
import { TabsComponent } from './../../../tabs/tabs.component';
import { CustomFormControl, CustomFormGroup } from './../../../controls/click-to-edit/click-to-edit.component';
import { ArmObj, ArmArrayResult } from './../../../shared/models/arm/arm-obj';
import { TblItem } from './../../../controls/tbl/tbl.component';
import { CacheService } from './../../../shared/services/cache.service';
import { AuthzService } from './../../../shared/services/authz.service';
//import { UniqueValidator } from 'app/shared/validators/uniqueValidator';
//import { RequiredValidator } from 'app/shared/validators/requiredValidator';

export class JavaWebContainerProperties {
  container: string;
  containerMajorVersion: string;
  containerMinorVersion: string;
}

export class JavaSettingsGroups {
  majorVersion: FormGroup;
  minorVersion: FormGroup;
  webContainer: FormGroup;
}

export class GeneralSettingsGroups {
  clientAffinityEnabled: FormGroup;
  use32BitWorkerProcess: FormGroup;
  webSocketsEnabled: FormGroup;
  alwaysOn: FormGroup;
  managedPipelineMode: FormGroup;
  remoteDebuggingEnabled: FormGroup;
  remoteDebuggingVersion: FormGroup;
}

@Component({
  selector: 'general-settings',
  templateUrl: './general-settings.component.html',
  styleUrls: ['./../site-config.component.scss']
})
export class GeneralSettingsComponent implements OnChanges, OnDestroy {
  public Resources = PortalResources;
  public group: FormGroup;

  private _resourceIdStream: Subject<string>;
  private _resourceIdSubscription: RxSubscription;
  private _writePermission: boolean;
  private _readOnlyLock: boolean;
  public hasWritePermissions: boolean;
  public permissionsMessage: string;

  private _busyState: BusyStateComponent;
  private _busyStateScopeManager: BusyStateScopeManager;
 
  private _authZService: AuthzService;

  private _saveError: string;

  //private _requiredValidator: RequiredValidator;
  //private _uniqueAppSettingValidator: UniqueValidator;

  private _webConfigArm: ArmObj<SiteConfig>;
  private _siteConfigArm: ArmObj<Site>;
  public loadingStateMessage: string;

  private _usingCustomContainer: boolean;
  private _isLinux: boolean;
  private _isDynamicSku: boolean;
  private _isFunctionApp: boolean;

  // private _workerProcess64BitEnabled = false;
  // private _webSocketsEnabled = false;


  private _availableStacksArm: ArmArrayResult<AvailableStack>;

  public clientAffinityEnabledOptions: SelectOption<boolean>[] = [{ displayLabel: "On", value: true },
                                                                  { displayLabel: "Off", value: false }];

  public use32BitWorkerProcessOptions: SelectOption<boolean>[] = [{ displayLabel: "32-bit", value: true },
                                                                  { displayLabel: "64-bit", value: false }];

  public webSocketsEnabledOptions: SelectOption<boolean>[] = [{ displayLabel: "On", value: true },
                                                              { displayLabel: "Off", value: false }];

  public alwaysOnOptions: SelectOption<boolean>[] = [{ displayLabel: "On", value: true },
                                                     { displayLabel: "Off", value: false }];

  public managedPipelineModeOptions: SelectOption<number>[] = [{ displayLabel: "Classic", value: 0 },
                                                               { displayLabel: "Integrated", value: 1 }];

  public remoteDebuggingEnabledOptions: SelectOption<boolean>[] = [{ displayLabel: "On", value: true },
                                                                   { displayLabel: "Off", value: false }];

  public remoteDebuggingVersionOptions: SelectOption<string>[] = [{ displayLabel: "2012", value: "VS2012" },
                                                                  { displayLabel: "2013", value: "VS2013" },
                                                                  { displayLabel: "2015", value: "VS2015" },
                                                                  { displayLabel: "2017", value: "VS2017" }];
  private _remoteDebuggingSubscription: RxSubscription;


  private _emptyJavaWebContainerProperties: JavaWebContainerProperties = { container: "-", containerMajorVersion: "", containerMinorVersion: "" };
  
  private _versionOptionsMap: { [key: string]: DropDownElement<string>[] };
  private _javaMinorVersionOptionsMap: { [key: string]: DropDownElement<string>[] };
  private _javaMinorToMajorVersionsMap: { [key: string]: string };

  private _selectedJavaVersion: string;
  private _javaVersionSubscription: RxSubscription;

  @Input() mainForm: FormGroup;

  @Input() resourceId: string;

  @ViewChild("javaVersionDropDown") _javaVersionDropDown : DropDownComponent<string>;
  @ViewChild("remoteDebuggingRadioButton") _remoteDebuggingRadioButton : RadioSelectorComponent<boolean>;

  constructor(
    private _cacheService: CacheService,
    private _fb: FormBuilder,
    private _translateService: TranslateService,
    private _aiService: AiService,
    authZService: AuthzService,
    tabsComponent: TabsComponent
    ) {
      this._busyState = tabsComponent.busyState;
      this._busyStateScopeManager = this._busyState.getScopeManager();
      
      this._authZService = authZService;

      this._resetPermissionsAndLoadingState();

      this._resourceIdStream = new Subject<string>();
      this._resourceIdSubscription = this._resourceIdStream
      .distinctUntilChanged()
      .switchMap(() => {
        this._busyStateScopeManager.setBusy();
        this._saveError = null;
        this._siteConfigArm = null;
        this._webConfigArm = null;
        this.group = null;
        this._clearChildSubscriptions();
        this._resetPermissionsAndLoadingState();
        return Observable.zip(
          this._authZService.hasPermission(this.resourceId, [AuthzService.writeScope]),
          this._authZService.hasReadOnlyLock(this.resourceId),
          (wp, rl) => ({writePermission: wp, readOnlyLock: rl})
        )
      })
      .mergeMap(p => {
        this._setPermissions(p.writePermission, p.readOnlyLock);
        return Observable.zip(
          Observable.of(this.hasWritePermissions),
          this._cacheService.getArm(`${this.resourceId}`, true),
          this._cacheService.getArm(`${this.resourceId}/config/web`, true),
          !this._availableStacksArm ? this._cacheService.getArm(`/providers/Microsoft.Web/availablestacks`, true) : Observable.of(null),
          (h, c, w, s) => ({hasWritePermissions: h, siteConfigResponse: c, webConfigResponse: w, availableStacksResponse: s})
        )
      })
      .do(null, error => {
        this._aiService.trackEvent("/errors/general-settings", error);
        this._setupForm(this._webConfigArm, this._siteConfigArm);
        this.loadingStateMessage = this._translateService.instant(PortalResources.configLoadFailure);
        this._busyStateScopeManager.clearBusy();
      })
      .retry()
      .subscribe(r => {
        this._siteConfigArm = r.siteConfigResponse.json();
        this._webConfigArm = r.webConfigResponse.json();
        this._availableStacksArm = this._availableStacksArm || r.availableStacksResponse.json();
        if(!this._versionOptionsMap){
          this._parseAvailableStacks(this._availableStacksArm);
        }
        this._setupForm(this._webConfigArm, this._siteConfigArm);
        this._busyStateScopeManager.clearBusy();
      });
  }

  ngOnChanges(changes: SimpleChanges){
    if (changes['resourceId']){
      this._resourceIdStream.next(this.resourceId);
    }
    if(changes['mainForm'] && !changes['resourceId']){
      this._setupForm(this._webConfigArm, this._siteConfigArm);
    }
  }

  ngAfterViewInit(){
    // this._javaVersionSubscription = this._javaVersionDropDown.value.subscribe(javaVersion => {
    //   this._updateJavaOptions(javaVersion);
    // });
  }

  ngOnDestroy(): void{
    if(this._resourceIdSubscription) { this._resourceIdSubscription.unsubscribe(); }
    this._clearChildSubscriptions();
    this._busyStateScopeManager.dispose();
  }

  private _resetPermissionsAndLoadingState(){
    this._writePermission = true;
    this._readOnlyLock = false;
    this.hasWritePermissions = true;
    this.permissionsMessage = "";
    this.loadingStateMessage = this._translateService.instant(PortalResources.configLoading);
  }

  private _setPermissions(writePermission: boolean, readOnlyLock: boolean){
    this._writePermission = writePermission;
    this._readOnlyLock = readOnlyLock;

    if(!this._writePermission){
      this.permissionsMessage = this._translateService.instant(PortalResources.configRequiresWritePermissionOnApp);
    }
    else if(this._readOnlyLock){
      this.permissionsMessage = this._translateService.instant(PortalResources.configDisabledReadOnlyLockOnApp);
    }
    else{
      this.permissionsMessage = "";
    }

    this.hasWritePermissions = this._writePermission && !this._readOnlyLock;
  }

  private _setupChildSubscriptions(){
    this._clearChildSubscriptions();
    if(!!this.group)
    {
      this._javaVersionSubscription = this._javaVersionDropDown.value.subscribe(javaVersion => {
        this._updateJavaOptions(javaVersion);
      });
      this._remoteDebuggingSubscription = this._remoteDebuggingRadioButton.value.subscribe(enabled => {
        this._setControlsDisabed(["remoteDebuggingVersion"], !enabled);
      })
    }
  }

  private _clearChildSubscriptions(){
    if(this._javaVersionSubscription){ this._javaVersionSubscription.unsubscribe(); }
    if(this._remoteDebuggingSubscription){ this._remoteDebuggingSubscription.unsubscribe(); }
  }

  private _setupForm(webConfigArm: ArmObj<SiteConfig>, siteConfigArm: ArmObj<Site>){
    if(!!webConfigArm || !siteConfigArm){

      this._clearChildSubscriptions();

      if(!this._saveError || !this.group){
        let netFrameWorkVersion = this._setupNetFramworkVersion(webConfigArm.properties.netFrameworkVersion);
        let phpVersion = this._setupPhpVersion(webConfigArm.properties.phpVersion);
        let pythonVersion = this._setupPythonVersion(webConfigArm.properties.pythonVersion);
        let java: JavaSettingsGroups = this._setupJava(webConfigArm.properties.javaVersion, webConfigArm.properties.javaContainer, webConfigArm.properties.javaContainerVersion);
        let generalSettings: GeneralSettingsGroups = this._setupGeneralSettings(webConfigArm, siteConfigArm);

        this.group = this._fb.group({
          netFrameWorkVersion: netFrameWorkVersion,
          phpVersion: phpVersion,
          pythonVersion: pythonVersion,
          javaVersion: java.majorVersion,
          javaMinorVersion: java.minorVersion,
          javaWebContainer: java.webContainer,
          clientAffinityEnabled: generalSettings.clientAffinityEnabled,
          use32BitWorkerProcess: generalSettings.use32BitWorkerProcess,
          webSocketsEnabled: generalSettings.webSocketsEnabled,
          alwaysOn: generalSettings.alwaysOn,
          managedPipelineMode: generalSettings.managedPipelineMode,
          remoteDebuggingEnabled: generalSettings.remoteDebuggingEnabled,
          remoteDebuggingVersion: generalSettings.remoteDebuggingVersion
        });
      }
        
      if(this.mainForm.contains("generalSettings")){
        this.mainForm.setControl("generalSettings", this.group);
      }
      else{
        this.mainForm.addControl("generalSettings", this.group);
      }

      setTimeout(() => { this._setupChildSubscriptions(); }, 0);

    }
    else{

      this.group = null;

      if(this.mainForm.contains("generalSettings")){
        this.mainForm.removeControl("generalSettings");
      }

    }

    this._saveError = null;

  }

  private _setControlsDisabed(names: string[], disable: boolean){
    if(!!this.group && !!names){
      names.forEach(name => {
        if(!!this.group.controls[name]){
          if(disable){
            this.group.controls[name].disable();
          }
          else{
            this.group.controls[name].enable();
          }
        }
      })
    }
  }

  private _setupGeneralSettings(webConfigArm: ArmObj<SiteConfig>, siteConfigArm: ArmObj<Site>): GeneralSettingsGroups{
    let clientAffinityEnabledGroup = this._fb.group({
      value: siteConfigArm.properties.clientAffinityEnabled
    });


    let use32BitWorkerProcessGroup = this._fb.group({
      value: webConfigArm.properties.use32BitWorkerProcess
    });


    let webSocketsEnabledGroup = this._fb.group({
      value: webConfigArm.properties.webSocketsEnabled
    });


    let alwaysOnGroup = this._fb.group({
      value: webConfigArm.properties.alwaysOn
    });


    let managedPipelineModeGroup = this._fb.group({
      value: webConfigArm.properties.managedPipelineMode
    });


    let remoteDebuggingEnabledGroup = this._fb.group({
      value: webConfigArm.properties.remoteDebuggingEnabled
    });


    let remoteDebuggingVersionGroup = this._fb.group({
      value: webConfigArm.properties.remoteDebuggingVersion
    });

    setTimeout(() => { this._setControlsDisabed(["remoteDebuggingVersion"], !webConfigArm.properties.remoteDebuggingEnabled);  }, 0);

    return {
      clientAffinityEnabled: clientAffinityEnabledGroup,
      use32BitWorkerProcess: use32BitWorkerProcessGroup,
      webSocketsEnabled: webSocketsEnabledGroup,
      alwaysOn: alwaysOnGroup,
      managedPipelineMode: managedPipelineModeGroup,
      remoteDebuggingEnabled: remoteDebuggingEnabledGroup,
      remoteDebuggingVersion: remoteDebuggingVersionGroup
    };
  }

  private _setupNetFramworkVersion(netFrameworkVersion: string): FormGroup{
    let defaultValue = "";

    let netFrameworkVersionOptions: DropDownElement<string>[] = [];
    let netFrameworkVersionOptionsClean = this._versionOptionsMap[AvailableStackNames.NetStack];

    netFrameworkVersionOptionsClean.forEach(element => {
      let match = element.value === netFrameworkVersion || (!element.value && !netFrameworkVersion);
      defaultValue = match ? element.value : defaultValue;

      netFrameworkVersionOptions.push({
        displayLabel: element.displayLabel,
        value: element.value,
        default: match
      });
    })

    let netFrameWorkVersionGroup = this._fb.group({
      value: defaultValue
    });
    (<any>netFrameWorkVersionGroup).options = netFrameworkVersionOptions;

    return netFrameWorkVersionGroup;
  }
  
  private _setupPhpVersion(phpVersion: string): FormGroup{
    let defaultValue = "";

    let phpVersionOptions: DropDownElement<string>[] = [];
    let phpVersionOptionsClean = this._versionOptionsMap[AvailableStackNames.PhpStack];

    phpVersionOptionsClean.forEach(element => {
      let match = element.value === phpVersion || (!element.value && !phpVersion);
      defaultValue = match ? element.value : defaultValue;

      phpVersionOptions.push({
        displayLabel: element.displayLabel,
        value: element.value,
        default: match
      });
    })

    let phpVersionGroup = this._fb.group({
      value: defaultValue
    });
    (<any>phpVersionGroup).options = phpVersionOptions;

    return phpVersionGroup;
  }
  
  private _setupPythonVersion(pythonVersion: string): FormGroup{
    let defaultValue = "";

    let pythonVersionOptions: DropDownElement<string>[] = [];
    let pythonVersionOptionsClean = this._versionOptionsMap[AvailableStackNames.PythonStack];

    pythonVersionOptionsClean.forEach(element => {
      let match = element.value === pythonVersion || (!element.value && !pythonVersion);
      defaultValue = match ? element.value : defaultValue;

      pythonVersionOptions.push({
        displayLabel: element.displayLabel,
        value: element.value,
        default: match
      });
    })

    let pythonVersionGroup = this._fb.group({
      value: defaultValue
    });
    (<any>pythonVersionGroup).options = pythonVersionOptions;

    return pythonVersionGroup;
  }

  private _setupJava(javaVersion: string, javaContainer: string, javaContainerVersion: string): JavaSettingsGroups{
    let defaultJavaMinorVersion = "";
    let javaMinorVersionOptions: DropDownElement<string>[] = [];
    
    let defaultJavaVersion = "";
    let javaVersionOptions: DropDownElement<string>[] = [];
    let javaVersionOptionsClean = this._versionOptionsMap[AvailableStackNames.JavaStack];

    let defaultJavaWebContainer = JSON.stringify(this._emptyJavaWebContainerProperties);
    let javaWebContainerOptions: DropDownElement<string>[] = [];
    let javaWebContainerOptionsClean = this._versionOptionsMap[AvailableStackNames.JavaContainer];

    if(javaVersion){
      if(this._javaMinorVersionOptionsMap[javaVersion]){
        defaultJavaVersion = javaVersion;
      }
      else if(this._javaMinorToMajorVersionsMap[javaVersion]){
        defaultJavaVersion = this._javaMinorToMajorVersionsMap[javaVersion];
        defaultJavaMinorVersion = javaVersion;
      }
      else{
        //TODO: How to handle an invalid javaVersion string
        //javaVersion = "";
      }
    }

    //MajorVersion
    this._selectedJavaVersion = defaultJavaVersion;
    javaVersionOptionsClean.forEach(element => {
      javaVersionOptions.push({
        displayLabel: element.displayLabel,
        value: element.value,
        default: element.value === defaultJavaVersion || (!element.value && !defaultJavaVersion)
      });
    })
    let javaVersionGroup = this._fb.group({
      value: defaultJavaVersion
    });
    (<any>javaVersionGroup).options = javaVersionOptions;

    //MinorVersion
    if(defaultJavaVersion){
      this._javaMinorVersionOptionsMap[defaultJavaVersion].forEach(element => {
        javaMinorVersionOptions.push({
          displayLabel: element.displayLabel,
          value: element.value,
          default: element.value === defaultJavaMinorVersion || (!element.value && !defaultJavaMinorVersion)
        });
      })
    }
    else{
      javaMinorVersionOptions = [];
    }

    let javaMinorVersionGroup = this._fb.group({
      value: defaultJavaMinorVersion
    });
    (<any>javaMinorVersionGroup).options = javaMinorVersionOptions;


    //WebContainer
    if(defaultJavaVersion){
      javaWebContainerOptionsClean.forEach(element => {
        let match = false;
        let parsedValue: JavaWebContainerProperties = JSON.parse(element.value);
        if(parsedValue.container.toUpperCase() === javaContainer &&
           (parsedValue.containerMinorVersion === javaContainerVersion ||
            (parsedValue.containerMajorVersion === javaContainerVersion && !parsedValue.containerMinorVersion))){
          defaultJavaWebContainer = element.value;
          match = true;
        }
        javaWebContainerOptions.push({
          displayLabel: element.displayLabel,
          value: element.value,
          default: match
        });
      })
    }
    else{
      javaWebContainerOptions = [];
    }

    let javaWebContainerGroup = this._fb.group({
      value: defaultJavaWebContainer
    });
    (<any>javaWebContainerGroup).options = javaWebContainerOptions;


    setTimeout(() => { this._setControlsDisabed(["javaMinorVersion", "javaWebContainer"], !this._selectedJavaVersion);  }, 0);

    return {
      majorVersion:javaVersionGroup,
      minorVersion:javaMinorVersionGroup,
      webContainer:javaWebContainerGroup
    };

  }

  private _updateJavaOptions(javaVersion: string){
    let previousJavaVersionSelection = this._selectedJavaVersion;
    let javaMinorVersionOptions: DropDownElement<string>[];
    let defaultJavaMinorVersion: string;
    let javaMinorVersionNeedsUpdate: boolean = false;

    let javaWebContainerOptions: DropDownElement<string>[];
    let defaultJavaWebContainer: string;
    let javaWebContainerNeedsUpdate: boolean = false;

    this._selectedJavaVersion = javaVersion;

    if(!javaVersion){
      if(previousJavaVersionSelection){
        javaMinorVersionOptions = [];
        defaultJavaMinorVersion = "";
        javaMinorVersionNeedsUpdate = true;

        javaWebContainerOptions = [];
        defaultJavaWebContainer = JSON.stringify(this._emptyJavaWebContainerProperties);
        javaWebContainerNeedsUpdate = true;
      }
    }
    else{
      let javaMinorVersionOptionsClean = this._javaMinorVersionOptionsMap[javaVersion] || [];
      javaMinorVersionOptions = JSON.parse(JSON.stringify(javaMinorVersionOptionsClean));
      javaMinorVersionOptions.forEach(element => {
        element.default = !element.value;
      })
      defaultJavaMinorVersion = "";
      javaMinorVersionNeedsUpdate = true;

      if(!previousJavaVersionSelection){
        let javaWebContainerOptionsClean = this._versionOptionsMap[AvailableStackNames.JavaContainer];
        javaWebContainerOptions = JSON.parse(JSON.stringify(javaWebContainerOptionsClean));
        javaWebContainerOptions[0].default = true;
        defaultJavaWebContainer = javaWebContainerOptions[0].value;
        javaWebContainerNeedsUpdate = true;
      }
    }

    //MinorVersion
    if(javaMinorVersionNeedsUpdate){
      let javaMinorVersionGroup = this._fb.group({
        value: defaultJavaMinorVersion
      });
      (<any>javaMinorVersionGroup).options = javaMinorVersionOptions;

      if(!!this.group.controls["javaMinorVersion"]){
        this.group.setControl("javaMinorVersion", javaMinorVersionGroup);
      }
      else{
        this.group.addControl("javaMinorVersion", javaMinorVersionGroup);
      }
      (<FormGroup>this.group.controls["javaMinorVersion"]).controls["value"].markAsDirty();
    }

    //WebContainer
    if(javaWebContainerNeedsUpdate){
      let javaWebContainerGroup = this._fb.group({
        value: defaultJavaWebContainer
      });
      (<any>javaWebContainerGroup).options = javaWebContainerOptions;

      if(!!this.group.controls["javaWebContainer"]){
        this.group.setControl("javaWebContainer", javaWebContainerGroup);
      }
      else{
        this.group.addControl("javaWebContainer", javaWebContainerGroup);
      }
      (<FormGroup>this.group.controls["javaWebContainer"]).controls["value"].markAsDirty();
    }

    setTimeout(() => { this._setControlsDisabed(["javaMinorVersion", "javaWebContainer"], !this._selectedJavaVersion);  }, 0);
  }

  private _parseAvailableStacks(availableStacksArm: ArmArrayResult<AvailableStack>){
    this._availableStacksArm = availableStacksArm;
    this._versionOptionsMap = {};
    
    this._availableStacksArm.value.forEach(availableStackArm => {
      switch(availableStackArm.name)
      {
        case AvailableStackNames.NetStack:
          this._parseNetStackOptions(availableStackArm.properties);
          break;
        case AvailableStackNames.PhpStack:
          this._parsePhpStackOptions(availableStackArm.properties);
          break;
        case AvailableStackNames.PythonStack:
          this._parsePythonStackOptions(availableStackArm.properties);
          break;
        case AvailableStackNames.JavaStack:
          this._parseJavaStackOptions(availableStackArm.properties);
          break;
        case AvailableStackNames.JavaContainer:
          this._parseJavaContainerOptions(availableStackArm.properties);
          break;
        default:
          break;
      }
    })
  }

  private _parseNetStackOptions(availableStack: AvailableStack){
    this._versionOptionsMap = this._versionOptionsMap || {};

    let netFrameworkVersionOptions: DropDownElement<string>[] = [];

    availableStack.majorVersions.forEach(majorVersion => {
      netFrameworkVersionOptions.push({
        displayLabel: majorVersion.displayVersion,
        value: majorVersion.runtimeVersion,
        default: false
      });
    })

    this._versionOptionsMap[AvailableStackNames.NetStack] = netFrameworkVersionOptions;
  }

  private _parsePhpStackOptions(availableStack: AvailableStack){
    this._versionOptionsMap = this._versionOptionsMap || {};

    let phpVersionOptions: DropDownElement<string>[] = [];

    phpVersionOptions.push({
      displayLabel: "Off",
      value: "",
      default: false
    });

    availableStack.majorVersions.forEach(majorVersion => {
      phpVersionOptions.push({
        displayLabel: majorVersion.displayVersion,
        value: majorVersion.runtimeVersion,
        default: false
      });
    })

    this._versionOptionsMap[AvailableStackNames.PhpStack] = phpVersionOptions;
  }

  private _parsePythonStackOptions(availableStack: AvailableStack){
    this._versionOptionsMap = this._versionOptionsMap || {};

    let pythonVersionOptions: DropDownElement<string>[] = [];

    pythonVersionOptions.push({
      displayLabel: "Off",
      value: "",
      default: false
    });

    availableStack.majorVersions.forEach(majorVersion => {
      pythonVersionOptions.push({
        displayLabel: majorVersion.displayVersion,
        value: majorVersion.runtimeVersion,
        default: false
      });
    })

    this._versionOptionsMap[AvailableStackNames.PythonStack] = pythonVersionOptions;
  }

  private _parseJavaStackOptions(availableStack: AvailableStack){
    this._versionOptionsMap = this._versionOptionsMap || {};
    this._javaMinorToMajorVersionsMap = {};
    this._javaMinorVersionOptionsMap = {};

    let javaVersionOptions: DropDownElement<string>[] = [];

    javaVersionOptions.push({
      displayLabel: "Off",
      value: "",
      default: false
    });

    availableStack.majorVersions.forEach(majorVersion => {
      this._parseJavaMinorStackOptions(majorVersion);

      javaVersionOptions.push({
        displayLabel: "Java " + majorVersion.displayVersion.substr(2),
        value: majorVersion.runtimeVersion,
        default: false
      });
    })

    this._versionOptionsMap[AvailableStackNames.JavaStack] = javaVersionOptions;
  }

  private _parseJavaMinorStackOptions(majorVersion: MajorVersion){
    this._javaMinorToMajorVersionsMap = this._javaMinorToMajorVersionsMap || {};
    this._javaMinorVersionOptionsMap = this._javaMinorVersionOptionsMap || {};

    let javaMinorVersionOptions: DropDownElement<string>[] = [];

    majorVersion.minorVersions.forEach(minorVersion => {
      this._javaMinorToMajorVersionsMap[minorVersion.runtimeVersion] = majorVersion.runtimeVersion;
      javaMinorVersionOptions.push({
        displayLabel: minorVersion.displayVersion,
        value: minorVersion.runtimeVersion,
        default: false
      });
    })

    javaMinorVersionOptions.push({
      displayLabel: "Newest",
      value: "",
      default: false
    });

    this._javaMinorVersionOptionsMap[majorVersion.runtimeVersion] = javaMinorVersionOptions;
  }

  private _parseJavaContainerOptions(availableStack: AvailableStack){
    this._versionOptionsMap = this._versionOptionsMap || {};

    let javaWebContainerOptions: DropDownElement<string>[] = [];

    availableStack.frameworks.forEach(framework => {

      framework.majorVersions.forEach(majorVersion => {
        
        majorVersion.minorVersions.forEach(minorVersion => {

          javaWebContainerOptions.push({
            displayLabel: framework.display + " " + minorVersion.displayVersion,
            value: JSON.stringify({container: framework.name, containerMajorVersion: majorVersion.runtimeVersion, containerMinorVersion: minorVersion.runtimeVersion}), //TODO
            default: false
          });

        })

        javaWebContainerOptions.push({
            displayLabel: "Newest " + framework.display + " " + majorVersion.displayVersion,
            value: JSON.stringify({container: framework.name, containerMajorVersion: majorVersion.runtimeVersion, containerMinorVersion: ""}), //TODO
            default: false
        });

      })

    })

    this._versionOptionsMap[AvailableStackNames.JavaContainer] = javaWebContainerOptions;
  }

  validate(){
  }

  save() : Observable<SaveResult>{
    let generalSettingsControls = this.group.controls;

    if(this.mainForm.valid){
      //level: site
      let siteConfigArm: ArmObj<Site> = JSON.parse(JSON.stringify(this._siteConfigArm));
      let clientAffinityEnabled = <boolean>(generalSettingsControls['clientAffinityEnabled'].value.value);
      siteConfigArm.properties.clientAffinityEnabled = clientAffinityEnabled ;

      //level: site/config/web
      let webConfigArm: ArmObj<SiteConfig> = JSON.parse(JSON.stringify(this._webConfigArm));

      // -- non-stack settings --
      let use32BitWorkerProcess = <boolean>(generalSettingsControls['use32BitWorkerProcess'].value.value);
      let webSocketsEnabled = <boolean>(generalSettingsControls['webSocketsEnabled'].value.value);
      let alwaysOn = <boolean>(generalSettingsControls['alwaysOn'].value.value);
      let managedPipelineMode = <string>(generalSettingsControls['managedPipelineMode'].value.value);
      let remoteDebuggingEnabled = <boolean>(generalSettingsControls['remoteDebuggingEnabled'].value.value);
      let remoteDebuggingVersion = <string>(generalSettingsControls['remoteDebuggingVersion'].value.value);

      webConfigArm.properties.use32BitWorkerProcess = use32BitWorkerProcess;
      webConfigArm.properties.webSocketsEnabled = webSocketsEnabled;
      webConfigArm.properties.alwaysOn = alwaysOn;
      webConfigArm.properties.managedPipelineMode = managedPipelineMode;
      webConfigArm.properties.remoteDebuggingEnabled = remoteDebuggingEnabled;
      webConfigArm.properties.remoteDebuggingVersion = remoteDebuggingVersion;

      // -- stacks settings --
      let netFrameWorkVersion = <string>(generalSettingsControls['netFrameWorkVersion'].value.value);
      let phpVersion = <string>(generalSettingsControls['phpVersion'].value.value);
      let pythonVersion = <string>(generalSettingsControls['pythonVersion'].value.value);

      let javaVersion = <string>(generalSettingsControls['javaVersion'].value.value);
      let javaMinorVersion = <string>(generalSettingsControls['javaMinorVersion'].value.value);
      javaVersion = javaMinorVersion || javaVersion;

      let javaWebContainer = <string>(generalSettingsControls['javaWebContainer'].value.value);
      let javaWebContainerParsed: JavaWebContainerProperties = JSON.parse(javaWebContainer);
      let javaContainer = javaWebContainerParsed.container;
      let javaContainerVersion = javaWebContainerParsed.containerMinorVersion || javaWebContainerParsed.containerMajorVersion;

      if(!javaVersion){
        javaContainer = "";
        javaContainerVersion = "";
      }

      webConfigArm.properties.netFrameworkVersion = netFrameWorkVersion;
      webConfigArm.properties.phpVersion = phpVersion;
      webConfigArm.properties.pythonVersion = pythonVersion;
      webConfigArm.properties.javaVersion = javaVersion || "";
      webConfigArm.properties.javaContainer = javaContainer || "";
      webConfigArm.properties.javaContainerVersion = javaContainerVersion || "";

      return Observable.zip(
        this._cacheService.putArm(`${this.resourceId}`, null, siteConfigArm),
        this._cacheService.putArm(`${this.resourceId}/config/web`, null, webConfigArm),
        (c, w) => ({siteConfigResponse: c, webConfigResponse: w})
      )
      .map(r => {
        this._siteConfigArm = r.siteConfigResponse.json();
        this._webConfigArm = r.webConfigResponse.json();
        return {
          success: true,
          error: null
        };
      })
      .catch(error => {
        //this._siteConfigArm = null;
        //this._webConfigArm = null;
        this._saveError = error._body;
        return Observable.of({
          success: false,
          error: error._body
        });
      });
    }
    else{
      return Observable.of({
        success: false,
        error: "Failed to save General Settings due to invalid input."
      });
    }
  }

  //discard(){
  //  this.group.reset();
  //  this._setupForm(this._webConfigArm);
  //}
}