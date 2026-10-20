; =============================================================================
; Company Phone Tracker (NEXUS) - Production Windows Installer (Inno Setup 6)
; Target: Headless Kiosk Mini PCs (Windows 10 / 11 x64)
;
; Features:
;   - Fixed AppId GUID so upgrades are detected automatically
;   - App files -> C:\Program Files\PhoneTracker
;   - Data files -> C:\ProgramData\PhoneTracker (postgres_data, backups, logs, data, uploads, .env)
;   - Refuses downgrades unless /ALLOWDOWNGRADE is passed
;   - Skips config wizard pages on upgrade (keeps existing .env values; shows What's New)
;   - Keeps previous version in C:\Program Files\PhoneTracker\_previous before replacing files
;   - Automatic rollback from _previous if `prisma db push` (without --accept-data-loss) fails
;   - Supports silent remote upgrades:
;     PhoneTrackerSetup-x.y.z.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="C:\ProgramData\PhoneTracker\logs\install.log"
; =============================================================================

#ifndef MyAppVersion
  #define MyAppVersion "1.0.5"
#endif

#ifndef StageDir
  #define StageDir "..\dist\stage\PhoneTracker"
#endif

#define MyAppName "Company Phone Tracker"
#define MyAppPublisher "Company Phone Tracker (NEXUS)"
#define MyAppId "{{8F6E2A1B-4C9D-4E7A-9B3C-1D5F8A2E6C04}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\PhoneTracker
DisableDirPage=yes
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=PhoneTrackerSetup-{#MyAppVersion}
Compression=lzma2/fast
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
UninstallDisplayName={#MyAppName}
WizardStyle=modern
CloseApplications=no
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]
Name: "{code:GetDataDir}"; Flags: uninsneveruninstall
Name: "{code:GetDataDir}\postgres_data"; Flags: uninsneveruninstall
Name: "{code:GetDataDir}\backups"; Flags: uninsneveruninstall
Name: "{code:GetDataDir}\logs"; Flags: uninsneveruninstall
Name: "{code:GetDataDir}\data"; Flags: uninsneveruninstall
Name: "{code:GetDataDir}\uploads"; Flags: uninsneveruninstall
Name: "{code:GetDataDir}\uploads\incident-proofs"; Flags: uninsneveruninstall

[InstallDelete]
Type: filesandordirs; Name: "{app}\.next"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "{app}\kiosk-boot\launch-kiosk.bat"; Description: "Launch NEXUS Kiosk Mode now"; Flags: nowait postinstall skipifsilent shellexec runasoriginaluser

[Code]
var
  IsUpgradeInstall: Boolean;
  DetectedInstalledVersion: String;

  // Fresh install wizard pages
  KioskNetPage: TWizardPage;
  KioskCodeEdit: TNewEdit;
  AppHostEdit: TNewEdit;
  AppUrlEdit: TNewEdit;
  KioskUserEdit: TNewEdit;
  BackupMirrorEdit: TNewEdit;
  BackupMirrorBrowseBtn: TNewButton;

  AdminAccountPage: TWizardPage;
  AdminEmailEdit: TNewEdit;
  AdminNameEdit: TNewEdit;
  AdminPasswordEdit: TPasswordEdit;
  AdminPasswordConfirmEdit: TPasswordEdit;

  // Upgrade wizard page ("What's New" + Bulk Import Supervisors CSV)
  UpgradeInfoPage: TWizardPage;
  UpgradeInfoMemo: TNewMemo;
  SupervisorsCsvEdit: TNewEdit;
  SupervisorsCsvBrowseBtn: TNewButton;

  // Final page summary memo for release-check.mjs
  ReleaseCheckMemo: TNewMemo;
  ReleaseCheckSummaryText: String;
  UpgradeFailedAndRolledBack: Boolean;
  UpgradeFailureMessage: String;

function GetDataDir(Param: String): String;
begin
  if IsAdminInstallMode then
    Result := ExpandConstant('{commonappdata}\PhoneTracker')
  else
    Result := ExpandConstant('{localappdata}\PhoneTracker');
end;

function HasCmdLineSwitch(const SwitchName: String): Boolean;
var
  I: Integer;
  Param: String;
  Target1, Target2: String;
begin
  Result := False;
  Target1 := '/' + Uppercase(SwitchName);
  Target2 := '-' + Uppercase(SwitchName);
  for I := 1 to ParamCount do
  begin
    Param := Uppercase(ParamStr(I));
    if (Param = Target1) or (Param = Target2) or
       (Pos(Target1 + '=', Param) = 1) or (Pos(Target2 + '=', Param) = 1) then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function GetCmdLineValue(const KeyName, DefaultVal: String): String;
var
  I: Integer;
  Param, UpperParam, Prefix1, Prefix2: String;
begin
  Result := DefaultVal;
  Prefix1 := '/' + Uppercase(KeyName) + '=';
  Prefix2 := '-' + Uppercase(KeyName) + '=';
  for I := 1 to ParamCount do
  begin
    Param := ParamStr(I);
    UpperParam := Uppercase(Param);
    if Pos(Prefix1, UpperParam) = 1 then
    begin
      Result := Copy(Param, Length(Prefix1) + 1, MaxInt);
      Exit;
    end;
    if Pos(Prefix2, UpperParam) = 1 then
    begin
      Result := Copy(Param, Length(Prefix2) + 1, MaxInt);
      Exit;
    end;
  end;
end;

function DetectDefaultAppUrl(): String;
var
  TmpIpFile, CmdArgs: String;
  IpLines: TArrayOfString;
  DetectedIp: String;
  ResultCode: Integer;
begin
  Result := 'http://localhost:5000';
  TmpIpFile := ExpandConstant('{tmp}\cpt_lan_ip.txt');
  DeleteFile(TmpIpFile);
  CmdArgs :=
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
    '$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.IPAddress -notlike ''127.*'' -and $_.IPAddress -notlike ''169.254.*'' -and $_.PrefixOrigin -ne ''WellKnown'' -and $_.InterfaceAlias -notmatch ''vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Bluetooth|Docker'' } | ' +
    'Select-Object -First 1 -ExpandProperty IPAddress); ' +
    'if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.IPAddress -notlike ''127.*'' -and $_.IPAddress -notlike ''169.254.*'' -and $_.PrefixOrigin -ne ''WellKnown'' } | ' +
    'Select-Object -First 1 -ExpandProperty IPAddress) }; ' +
    'if (-not $ip) { $ip = ([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | ' +
    'Where-Object { $_.AddressFamily -eq ''InterNetwork'' -and -not [System.Net.IPAddress]::IsLoopback($_) -and ($_.ToString() -notlike ''169.254.*'') } | ' +
    'Select-Object -First 1).ToString() }; ' +
    'if ($ip) { Set-Content -Path ''' + TmpIpFile + ''' -Value $ip.Trim() -NoNewline -Encoding ASCII }"';
  if Exec('powershell.exe', CmdArgs, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    if FileExists(TmpIpFile) and LoadStringsFromFile(TmpIpFile, IpLines) then
    begin
      if GetArrayLength(IpLines) > 0 then
      begin
        DetectedIp := Trim(IpLines[0]);
        if DetectedIp <> '' then
          Result := 'http://' + DetectedIp + ':5000';
      end;
    end;
  end;
  DeleteFile(TmpIpFile);
end;

function ParseVersionPart(var VerStr: String): Integer;
var
  DotPos, DashPos, CutPos: Integer;
  Token: String;
begin
  if VerStr = '' then
  begin
    Result := 0;
    Exit;
  end;
  DotPos := Pos('.', VerStr);
  DashPos := Pos('-', VerStr);
  if (DotPos > 0) and ((DashPos = 0) or (DotPos < DashPos)) then
    CutPos := DotPos
  else if DashPos > 0 then
    CutPos := DashPos
  else
    CutPos := 0;

  if CutPos > 0 then
  begin
    Token := Copy(VerStr, 1, CutPos - 1);
    Delete(VerStr, 1, CutPos);
  end
  else
  begin
    Token := VerStr;
    VerStr := '';
  end;
  Result := StrToIntDef(Token, 0);
end;

// Returns > 0 if VerA > VerB, < 0 if VerA < VerB, 0 if equal
function CompareSemVer(const VerA, VerB: String): Integer;
var
  RemA, RemB: String;
  PartA, PartB, I: Integer;
begin
  RemA := Trim(VerA);
  RemB := Trim(VerB);
  for I := 1 to 3 do
  begin
    PartA := ParseVersionPart(RemA);
    PartB := ParseVersionPart(RemB);
    if PartA <> PartB then
    begin
      Result := PartA - PartB;
      Exit;
    end;
  end;
  Result := 0;
end;

function DetectExistingVersion(): String;
var
  UninstallKey: String;
  Ver: String;
begin
  Result := '';
  UninstallKey := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F6E2A1B-4C9D-4E7A-9B3C-1D5F8A2E6C04}_is1';
  if RegQueryStringValue(HKLM, UninstallKey, 'DisplayVersion', Ver) then
  begin
    Result := Trim(Ver);
    Exit;
  end;
  if RegQueryStringValue(HKCU, UninstallKey, 'DisplayVersion', Ver) then
  begin
    Result := Trim(Ver);
    Exit;
  end;
end;

function InitializeSetup(): Boolean;
var
  Cmp: Integer;
  Msg: String;
  HasExistingDbService: Boolean;
begin
  Result := True;
  UpgradeFailedAndRolledBack := False;
  UpgradeFailureMessage := '';
  DetectedInstalledVersion := DetectExistingVersion();
  HasExistingDbService := RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\CPT_DB') or
                          RegValueExists(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'CPT_Services');
  IsUpgradeInstall := HasExistingDbService and
                      ((DetectedInstalledVersion <> '') or
                       (FileExists(GetDataDir('') + '\.env') and
                        FileExists(ExpandConstant('{autopf}\PhoneTracker\server.js'))));

  if IsUpgradeInstall then
    Log(Format('Existing installation detected (version=%s). Running in UPGRADE mode.', [DetectedInstalledVersion]))
  else
    Log('No existing installation (or incomplete service setup) detected. Running in FRESH INSTALL mode.');

  // Downgrade guard: refuse to install an older version over a newer version unless /ALLOWDOWNGRADE is passed
  if (DetectedInstalledVersion <> '') then
  begin
    Cmp := CompareSemVer(DetectedInstalledVersion, '{#MyAppVersion}');
    if (Cmp > 0) and (not HasCmdLineSwitch('ALLOWDOWNGRADE')) then
    begin
      Msg := 'Downgrade Refused:' + #13#10 + #13#10 +
             'Installed version (' + DetectedInstalledVersion + ') is newer than this installer package ({#MyAppVersion}).' + #13#10 + #13#10 +
             'To protect database schema integrity, downgrading to an older version is blocked by default.' + #13#10 +
             'If you deliberately want to force a downgrade, run this installer with /ALLOWDOWNGRADE.';
      Log('ERROR: ' + Msg);
      SuppressibleMsgBox(Msg, mbCriticalError, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure OnBrowseBackupMirrorClick(Sender: TObject);
var
  Dir: String;
begin
  Dir := BackupMirrorEdit.Text;
  if BrowseForFolder('Select Optional Backup Mirror Directory (USB / Secondary Drive / Network Share):', Dir, True) then
    BackupMirrorEdit.Text := Dir;
end;

procedure CreateKioskNetWizardPage();
var
  Lbl: TNewStaticText;
  TopY: Integer;
  DefaultAppUrl: String;
begin
  DefaultAppUrl := DetectDefaultAppUrl();

  KioskNetPage := CreateCustomPage(
    wpWelcome,
    'Kiosk & Network Configuration',
    'Configure kiosk station identifier, network binding, email link URL, kiosk Windows user, and backup mirror.'
  );

  TopY := 0;

  Lbl := TNewStaticText.Create(KioskNetPage);
  Lbl.Parent := KioskNetPage.Surface;
  Lbl.Caption := 'Kiosk Station Code (KIOSK_CODE):';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(2);

  KioskCodeEdit := TNewEdit.Create(KioskNetPage);
  KioskCodeEdit.Parent := KioskNetPage.Surface;
  KioskCodeEdit.Left := 0;
  KioskCodeEdit.Top := TopY;
  KioskCodeEdit.Width := KioskNetPage.SurfaceWidth;
  KioskCodeEdit.Text := GetCmdLineValue('KIOSK_CODE', 'PHONE-KIOSK-01');
  TopY := TopY + KioskCodeEdit.Height + ScaleY(6);

  Lbl := TNewStaticText.Create(KioskNetPage);
  Lbl.Parent := KioskNetPage.Surface;
  Lbl.Caption := 'Web Server Bind Address (APP_HOST — keep 0.0.0.0 so supervisor email links work across LAN):';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(2);

  AppHostEdit := TNewEdit.Create(KioskNetPage);
  AppHostEdit.Parent := KioskNetPage.Surface;
  AppHostEdit.Left := 0;
  AppHostEdit.Top := TopY;
  AppHostEdit.Width := KioskNetPage.SurfaceWidth;
  AppHostEdit.Text := GetCmdLineValue('APP_HOST', '0.0.0.0');
  TopY := TopY + AppHostEdit.Height + ScaleY(6);

  Lbl := TNewStaticText.Create(KioskNetPage);
  Lbl.Parent := KioskNetPage.Surface;
  Lbl.Caption := 'Network URL for email links (APP_URL, optional — prefilled with detected LAN IPv4):';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(2);

  AppUrlEdit := TNewEdit.Create(KioskNetPage);
  AppUrlEdit.Parent := KioskNetPage.Surface;
  AppUrlEdit.Left := 0;
  AppUrlEdit.Top := TopY;
  AppUrlEdit.Width := KioskNetPage.SurfaceWidth;
  AppUrlEdit.Text := GetCmdLineValue('APP_URL', DefaultAppUrl);
  TopY := TopY + AppUrlEdit.Height + ScaleY(6);

  Lbl := TNewStaticText.Create(KioskNetPage);
  Lbl.Parent := KioskNetPage.Surface;
  Lbl.Caption := 'Kiosk Windows User Name (runs Microsoft Edge Kiosk & CPT_Edge_Watchdog):';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(2);

  KioskUserEdit := TNewEdit.Create(KioskNetPage);
  KioskUserEdit.Parent := KioskNetPage.Surface;
  KioskUserEdit.Left := 0;
  KioskUserEdit.Top := TopY;
  KioskUserEdit.Width := KioskNetPage.SurfaceWidth;
  KioskUserEdit.Text := GetCmdLineValue('KIOSK_USER', GetUserNameString());
  TopY := TopY + KioskUserEdit.Height + ScaleY(6);

  Lbl := TNewStaticText.Create(KioskNetPage);
  Lbl.Parent := KioskNetPage.Surface;
  Lbl.Caption := 'Optional Backup Mirror Directory (BACKUP_MIRROR_DIR — leave blank to skip):';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(2);

  BackupMirrorEdit := TNewEdit.Create(KioskNetPage);
  BackupMirrorEdit.Parent := KioskNetPage.Surface;
  BackupMirrorEdit.Left := 0;
  BackupMirrorEdit.Top := TopY;
  BackupMirrorEdit.Width := KioskNetPage.SurfaceWidth - ScaleX(90);
  BackupMirrorEdit.Text := GetCmdLineValue('BACKUP_MIRROR_DIR', '');

  BackupMirrorBrowseBtn := TNewButton.Create(KioskNetPage);
  BackupMirrorBrowseBtn.Parent := KioskNetPage.Surface;
  BackupMirrorBrowseBtn.Caption := 'Browse...';
  BackupMirrorBrowseBtn.Left := KioskNetPage.SurfaceWidth - ScaleX(82);
  BackupMirrorBrowseBtn.Top := TopY - ScaleY(1);
  BackupMirrorBrowseBtn.Width := ScaleX(82);
  BackupMirrorBrowseBtn.Height := BackupMirrorEdit.Height + ScaleY(2);
  BackupMirrorBrowseBtn.OnClick := @OnBrowseBackupMirrorClick;
end;

procedure CreateAdminAccountWizardPage();
var
  Lbl: TNewStaticText;
  TopY: Integer;
begin
  AdminAccountPage := CreateCustomPage(
    KioskNetPage.ID,
    'System Administrator Account',
    'Pre-configured with NEXUS account credentials (admin@company.com, hr@company.com, phone-kiosk-01@company.local).'
  );

  TopY := 0;

  Lbl := TNewStaticText.Create(AdminAccountPage);
  Lbl.Parent := AdminAccountPage.Surface;
  Lbl.Caption := 'Administrator Email Address:';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(4);

  AdminEmailEdit := TNewEdit.Create(AdminAccountPage);
  AdminEmailEdit.Parent := AdminAccountPage.Surface;
  AdminEmailEdit.Left := 0;
  AdminEmailEdit.Top := TopY;
  AdminEmailEdit.Width := AdminAccountPage.SurfaceWidth;
  AdminEmailEdit.Text := GetCmdLineValue('ADMIN_EMAIL', 'admin@company.com');
  TopY := TopY + AdminEmailEdit.Height + ScaleY(12);

  Lbl := TNewStaticText.Create(AdminAccountPage);
  Lbl.Parent := AdminAccountPage.Surface;
  Lbl.Caption := 'Administrator Full Name:';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(4);

  AdminNameEdit := TNewEdit.Create(AdminAccountPage);
  AdminNameEdit.Parent := AdminAccountPage.Surface;
  AdminNameEdit.Left := 0;
  AdminNameEdit.Top := TopY;
  AdminNameEdit.Width := AdminAccountPage.SurfaceWidth;
  AdminNameEdit.Text := GetCmdLineValue('ADMIN_NAME', 'Global System Administrator');
  TopY := TopY + AdminNameEdit.Height + ScaleY(12);

  Lbl := TNewStaticText.Create(AdminAccountPage);
  Lbl.Parent := AdminAccountPage.Surface;
  Lbl.Caption := 'Administrator Password:';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(4);

  AdminPasswordEdit := TPasswordEdit.Create(AdminAccountPage);
  AdminPasswordEdit.Parent := AdminAccountPage.Surface;
  AdminPasswordEdit.Left := 0;
  AdminPasswordEdit.Top := TopY;
  AdminPasswordEdit.Width := AdminAccountPage.SurfaceWidth;
  AdminPasswordEdit.Text := 'f0wU57G_';
  TopY := TopY + AdminPasswordEdit.Height + ScaleY(12);

  Lbl := TNewStaticText.Create(AdminAccountPage);
  Lbl.Parent := AdminAccountPage.Surface;
  Lbl.Caption := 'Confirm Administrator Password:';
  Lbl.Top := TopY;
  Lbl.Left := 0;
  TopY := TopY + Lbl.Height + ScaleY(4);

  AdminPasswordConfirmEdit := TPasswordEdit.Create(AdminAccountPage);
  AdminPasswordConfirmEdit.Parent := AdminAccountPage.Surface;
  AdminPasswordConfirmEdit.Left := 0;
  AdminPasswordConfirmEdit.Top := TopY;
  AdminPasswordConfirmEdit.Width := AdminAccountPage.SurfaceWidth;
  AdminPasswordConfirmEdit.Text := 'f0wU57G_';
end;

procedure OnBrowseSupervisorsCsvClick(Sender: TObject);
var
  FileName: String;
begin
  FileName := SupervisorsCsvEdit.Text;
  if GetOpenFileName(
    'Select Supervisors CSV File (keyed by department_code):',
    FileName,
    ExpandConstant('{src}'),
    'CSV Files (*.csv)|*.csv|All Files (*.*)|*.*',
    'csv'
  ) then
    SupervisorsCsvEdit.Text := FileName;
end;

procedure CreateUpgradeInfoWizardPage();
var
  PrevVerText, DefaultSupCsv, CandidateSupCsv: String;
  Lbl: TNewStaticText;
  BottomAreaHeight: Integer;
begin
  UpgradeInfoPage := CreateCustomPage(
    wpWelcome,
    'Upgrade Summary & What''s New in v{#MyAppVersion}',
    'Existing installation detected — your data and configuration in C:\ProgramData\PhoneTracker will be preserved.'
  );

  if DetectedInstalledVersion <> '' then
    PrevVerText := DetectedInstalledVersion
  else
    PrevVerText := 'Installed Version';

  DefaultSupCsv := GetCmdLineValue('SUPERVISORS_CSV', '');
  if DefaultSupCsv = '' then
  begin
    CandidateSupCsv := ExpandConstant('{src}\supervisors.csv');
    if FileExists(CandidateSupCsv) then
      DefaultSupCsv := CandidateSupCsv;
  end;

  BottomAreaHeight := ScaleY(52);

  UpgradeInfoMemo := TNewMemo.Create(UpgradeInfoPage);
  UpgradeInfoMemo.Parent := UpgradeInfoPage.Surface;
  UpgradeInfoMemo.Left := 0;
  UpgradeInfoMemo.Top := 0;
  UpgradeInfoMemo.Width := UpgradeInfoPage.SurfaceWidth;
  UpgradeInfoMemo.Height := UpgradeInfoPage.SurfaceHeight - BottomAreaHeight;
  UpgradeInfoMemo.ScrollBars := ssVertical;
  UpgradeInfoMemo.ReadOnly := True;
  UpgradeInfoMemo.Lines.Clear;
  UpgradeInfoMemo.Lines.Add('Upgrade Path: ' + PrevVerText + '  ->  {#MyAppVersion}');
  UpgradeInfoMemo.Lines.Add('');
  UpgradeInfoMemo.Lines.Add('Preserved Configuration & Data (C:\ProgramData\PhoneTracker):');
  UpgradeInfoMemo.Lines.Add('  * .env secrets, KIOSK_CODE, APP_HOST, APP_URL, and DEPLOYMENT_ID are kept intact');
  UpgradeInfoMemo.Lines.Add('  * PostgreSQL database (postgres_data), backups, logs, data, and uploads are untouched');
  UpgradeInfoMemo.Lines.Add('');
  UpgradeInfoMemo.Lines.Add('What''s New & Automated Upgrade Procedure:');
  UpgradeInfoMemo.Lines.Add('  1. Cleanly stops CPT_Web, CPT_Worker, CPT_Agent, and flushes PGlite WAL via http://127.0.0.1:54320/shutdown');
  UpgradeInfoMemo.Lines.Add('  2. Takes a verified pre-upgrade JSON + SHA-256 snapshot via scripts\backup-db.mjs');
  UpgradeInfoMemo.Lines.Add('  3. Archives the previous application directory to C:\Program Files\PhoneTracker\_previous');
  UpgradeInfoMemo.Lines.Add('  4. Replaces application binaries and runs `prisma db push` WITHOUT --accept-data-loss');
  UpgradeInfoMemo.Lines.Add('  5. Optional Bulk Import of Supervisors by department_code via scripts\import-supervisors.mjs');
  UpgradeInfoMemo.Lines.Add('  6. Restarts all 4 NSSM services, Cloudflare Tunnel, and runs scripts\release-check.mjs');

  Lbl := TNewStaticText.Create(UpgradeInfoPage);
  Lbl.Parent := UpgradeInfoPage.Surface;
  Lbl.Caption := 'Optional Bulk Import Supervisors CSV by Department Code (leave blank to skip):';
  Lbl.Left := 0;
  Lbl.Top := UpgradeInfoMemo.Height + ScaleY(6);

  SupervisorsCsvEdit := TNewEdit.Create(UpgradeInfoPage);
  SupervisorsCsvEdit.Parent := UpgradeInfoPage.Surface;
  SupervisorsCsvEdit.Left := 0;
  SupervisorsCsvEdit.Top := Lbl.Top + Lbl.Height + ScaleY(2);
  SupervisorsCsvEdit.Width := UpgradeInfoPage.SurfaceWidth - ScaleX(90);
  SupervisorsCsvEdit.Text := DefaultSupCsv;

  SupervisorsCsvBrowseBtn := TNewButton.Create(UpgradeInfoPage);
  SupervisorsCsvBrowseBtn.Parent := UpgradeInfoPage.Surface;
  SupervisorsCsvBrowseBtn.Caption := 'Browse...';
  SupervisorsCsvBrowseBtn.Left := UpgradeInfoPage.SurfaceWidth - ScaleX(82);
  SupervisorsCsvBrowseBtn.Top := SupervisorsCsvEdit.Top - ScaleY(1);
  SupervisorsCsvBrowseBtn.Width := ScaleX(82);
  SupervisorsCsvBrowseBtn.Height := SupervisorsCsvEdit.Height + ScaleY(2);
  SupervisorsCsvBrowseBtn.OnClick := @OnBrowseSupervisorsCsvClick;
end;

procedure InitializeWizard();
begin
  CreateKioskNetWizardPage();
  CreateAdminAccountWizardPage();
  CreateUpgradeInfoWizardPage();

  // Add a read-only memo on the Finished page to show release-check.mjs summary
  ReleaseCheckMemo := TNewMemo.Create(WizardForm);
  ReleaseCheckMemo.Parent := WizardForm.FinishedPage;
  ReleaseCheckMemo.Left := WizardForm.FinishedLabel.Left;
  ReleaseCheckMemo.Top := WizardForm.FinishedLabel.Top + ScaleY(68);
  ReleaseCheckMemo.Width := WizardForm.FinishedPage.ClientWidth - (WizardForm.FinishedLabel.Left * 2);
  ReleaseCheckMemo.Height := WizardForm.FinishedPage.ClientHeight - ReleaseCheckMemo.Top - ScaleY(12);
  ReleaseCheckMemo.ScrollBars := ssVertical;
  ReleaseCheckMemo.ReadOnly := True;
  ReleaseCheckMemo.Font.Name := 'Consolas';
  ReleaseCheckMemo.Font.Size := 8;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  // Always skip the manual AdminAccountPage because the 3 NEXUS accounts are pre-configured automatically
  if PageID = AdminAccountPage.ID then
  begin
    Result := True;
    Exit;
  end;

  if IsUpgradeInstall then
  begin
    // During an upgrade, skip KIOSK_CODE / APP_HOST wizard page; only show What's New
    if PageID = KioskNetPage.ID then
      Result := True;
  end
  else
  begin
    // During a fresh install, skip the Upgrade What's New page
    if PageID = UpgradeInfoPage.ID then
      Result := True;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if (not IsUpgradeInstall) and (CurPageID = KioskNetPage.ID) then
  begin
    if Trim(KioskCodeEdit.Text) = '' then
    begin
      SuppressibleMsgBox('Please enter a KIOSK_CODE (for example: PHONE-KIOSK-01).', mbError, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
    if Trim(AppHostEdit.Text) = '' then
    begin
      SuppressibleMsgBox('Please enter an APP_HOST (default: 0.0.0.0).', mbError, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
    if Trim(KioskUserEdit.Text) = '' then
    begin
      SuppressibleMsgBox('Please enter the Kiosk Windows user name (default: KioskUser).', mbError, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure RunPreUpgradeBackupAndArchive();
var
  ScriptPath, AppDir, DataDir, CmdArgs: String;
  ResultCode: Integer;
  Lines: TArrayOfString;
begin
  AppDir := ExpandConstant('{app}');
  DataDir := GetDataDir('');
  ScriptPath := ExpandConstant('{tmp}\cpt-pre-upgrade.ps1');

  SetArrayLength(Lines, 82);
  Lines[0]  := 'param([string]$AppDir, [string]$DataDir)';
  Lines[1]  := '$ErrorActionPreference = "Continue"';
  Lines[2]  := 'Write-Host "[Pre-Upgrade] Stopping watchdog tasks and dependent services..."';
  Lines[3]  := 'foreach ($t in @("CPT_Service_Watchdog", "CPT_Edge_Watchdog")) {';
  Lines[4]  := '    Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue';
  Lines[5]  := '    Disable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue | Out-Null';
  Lines[6]  := '}';
  Lines[7]  := 'foreach ($s in @("CPT_Web", "CPT_Worker", "CPT_Agent")) {';
  Lines[8]  := '    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue';
  Lines[9]  := '    if ($null -ne $svc -and $svc.Status -ne "Stopped") {';
  Lines[10] := '        Stop-Service -Name $s -Force -ErrorAction SilentlyContinue';
  Lines[11] := '    }';
  Lines[12] := '}';
  Lines[13] := '$NodeExe = Join-Path $AppDir "node\node.exe"';
  Lines[14] := 'if (-not (Test-Path $NodeExe)) { $NodeExe = "node.exe" }';
  Lines[15] := '$BackupScript = Join-Path $AppDir "scripts\backup-db.mjs"';
  Lines[16] := 'if (Test-Path $BackupScript) {';
  Lines[17] := '    $dbSvc = Get-Service -Name "CPT_DB" -ErrorAction SilentlyContinue';
  Lines[18] := '    if ($null -ne $dbSvc -and $dbSvc.Status -ne "Running") {';
  Lines[19] := '        Start-Service -Name "CPT_DB" -ErrorAction SilentlyContinue';
  Lines[20] := '        $WaitScript = Join-Path $AppDir "scripts\wait-for-pg.mjs"';
  Lines[21] := '        if (Test-Path $WaitScript) { & $NodeExe $WaitScript }';
  Lines[22] := '    }';
  Lines[23] := '    $env:ENV_FILE_PATH = Join-Path $DataDir ".env"';
  Lines[24] := '    $env:BACKUP_DIR = Join-Path $DataDir "backups"';
  Lines[25] := '    $env:PG_DATA_DIR = Join-Path $DataDir "postgres_data"';
  Lines[26] := '    Write-Host "[Pre-Upgrade] Taking database backup with backup-db.mjs..."';
  Lines[27] := '    Push-Location $AppDir';
  Lines[28] := '    & $NodeExe $BackupScript';
  Lines[29] := '    Pop-Location';
  Lines[30] := '}';
  Lines[31] := 'Write-Host "[Pre-Upgrade] Requesting clean database shutdown via http://127.0.0.1:54320/shutdown..."';
  Lines[32] := 'try {';
  Lines[33] := '    Invoke-WebRequest -Uri "http://127.0.0.1:54320/shutdown" -Method Post -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null';
  Lines[34] := '    Start-Sleep -Seconds 2';
  Lines[35] := '} catch {}';
  Lines[36] := '$dbSvc = Get-Service -Name "CPT_DB" -ErrorAction SilentlyContinue';
  Lines[37] := 'if ($null -ne $dbSvc -and $dbSvc.Status -ne "Stopped") {';
  Lines[38] := '    Stop-Service -Name "CPT_DB" -Force -ErrorAction SilentlyContinue';
  Lines[39] := '    Start-Sleep -Seconds 2';
  Lines[40] := '}';
  Lines[41] := '# Ensure any node.exe or cloudflared.exe running from $AppDir or any PhoneTracker directory is terminated so files and ports are not locked';
  Lines[42] := 'try {';
  Lines[43] := '    $procs = @(Get-CimInstance Win32_Process -Filter "Name = ''node.exe'' OR Name = ''cloudflared.exe''" -ErrorAction SilentlyContinue)';
  Lines[44] := '    foreach ($p in $procs) {';
  Lines[45] := '        if ($p.ExecutablePath -and ($p.ExecutablePath.StartsWith($AppDir, [System.StringComparison]::OrdinalIgnoreCase) -or $p.ExecutablePath -like "*\PhoneTracker\node\node.exe" -or $p.ExecutablePath -like "*\PhoneTracker\tools\cloudflared.exe")) {';
  Lines[46] := '            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue';
  Lines[47] := '        }';
  Lines[48] := '    }';
  Lines[49] := '} catch {}';
  Lines[50] := 'Start-Sleep -Seconds 1';
  Lines[51] := '# Keep previous version app folder as _previous (only the last one)';
  Lines[52] := 'if (Test-Path $AppDir) {';
  Lines[53] := '    $PrevDir = Join-Path $AppDir "_previous"';
  Lines[54] := '    if (Test-Path $PrevDir) {';
  Lines[55] := '        Remove-Item -Path $PrevDir -Recurse -Force -ErrorAction SilentlyContinue';
  Lines[56] := '    }';
  Lines[57] := '    New-Item -ItemType Directory -Path $PrevDir -Force | Out-Null';
  Lines[58] := '    $Items = @(Get-ChildItem -Path $AppDir -Force | Where-Object { $_.Name -ne "_previous" -and $_.Name -notlike "unins*" })';
  Lines[59] := '    foreach ($Item in $Items) {';
  Lines[60] := '        $Dest = Join-Path $PrevDir $Item.Name';
  Lines[61] := '        try {';
  Lines[62] := '            Move-Item -Path $Item.FullName -Destination $Dest -Force -ErrorAction Stop';
  Lines[63] := '        } catch {';
  Lines[64] := '            Copy-Item -Path $Item.FullName -Destination $Dest -Recurse -Force -ErrorAction SilentlyContinue';
  Lines[65] := '            Remove-Item -Path $Item.FullName -Recurse -Force -ErrorAction SilentlyContinue';
  Lines[66] := '        }';
  Lines[67] := '    }';
  Lines[68] := '    Write-Host "[Pre-Upgrade] Saved previous version to $PrevDir"';
  Lines[69] := '}';
  Lines[70] := 'exit 0';
  SetArrayLength(Lines, 71);

  SaveStringsToUTF8FileWithoutBOM(ScriptPath, Lines, False);
  CmdArgs := Format('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%s" -AppDir "%s" -DataDir "%s"', [ScriptPath, AppDir, DataDir]);
  Log('Running pre-upgrade backup and _previous archive script...');
  Exec('powershell.exe', CmdArgs, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Log(Format('Pre-upgrade script exited with code %d', [ResultCode]));
  DeleteFile(ScriptPath);
end;

procedure RunPostInstallConfiguration();
var
  ScriptPath, PwTempFile, SummaryFile, ErrFile, AppDir, DataDir, CmdArgs: String;
  KioskCodeVal, AppHostVal, AppUrlVal, KioskUserVal, BackupMirrorVal, AdminEmailVal, AdminNameVal, AdminPwVal, SupervisorsCsvVal: String;
  IsUpgradeFlag: String;
  ResultCode: Integer;
  Lines, SummaryLines, ErrLines: TArrayOfString;
  I: Integer;
begin
  AppDir := ExpandConstant('{app}');
  DataDir := GetDataDir('');
  ScriptPath := ExpandConstant('{tmp}\cpt-post-install.ps1');
  PwTempFile := ExpandConstant('{tmp}\cpt_admin_pw.tmp');
  SummaryFile := ExpandConstant('{tmp}\cpt_release_check_summary.txt');
  ErrFile := ExpandConstant('{tmp}\cpt_upgrade_error.txt');

  KioskCodeVal := Trim(KioskCodeEdit.Text);
  AppHostVal := Trim(AppHostEdit.Text);
  AppUrlVal := Trim(AppUrlEdit.Text);
  KioskUserVal := Trim(KioskUserEdit.Text);
  BackupMirrorVal := Trim(BackupMirrorEdit.Text);
  AdminEmailVal := Trim(AdminEmailEdit.Text);
  AdminNameVal := Trim(AdminNameEdit.Text);
  AdminPwVal := AdminPasswordEdit.Text;
  SupervisorsCsvVal := Trim(SupervisorsCsvEdit.Text);

  if IsUpgradeInstall then
    IsUpgradeFlag := '1'
  else
    IsUpgradeFlag := '0';

  // Write admin password to a temporary file (never pass on command line); deleted immediately after create-admin.mjs
  if (not IsUpgradeInstall) then
  begin
    if (AdminPwVal = '') and (GetCmdLineValue('ADMIN_PASSWORD_FILE', '') <> '') then
      CopyFile(GetCmdLineValue('ADMIN_PASSWORD_FILE', ''), PwTempFile, False)
    else
      SaveStringToFile(PwTempFile, AdminPwVal + #13#10, False);
  end;

  SetArrayLength(Lines, 380);
  I := 0;
  Lines[I] := 'param('; I := I + 1;
  Lines[I] := '    [string]$AppDir,'; I := I + 1;
  Lines[I] := '    [string]$DataDir,'; I := I + 1;
  Lines[I] := '    [string]$IsUpgrade,'; I := I + 1;
  Lines[I] := '    [string]$KioskCode,'; I := I + 1;
  Lines[I] := '    [string]$AppHost,'; I := I + 1;
  Lines[I] := '    [string]$AppUrl,'; I := I + 1;
  Lines[I] := '    [string]$KioskUser,'; I := I + 1;
  Lines[I] := '    [string]$BackupMirrorDir,'; I := I + 1;
  Lines[I] := '    [string]$AdminEmail,'; I := I + 1;
  Lines[I] := '    [string]$AdminName,'; I := I + 1;
  Lines[I] := '    [string]$PwTempFile,'; I := I + 1;
  Lines[I] := '    [string]$SummaryFile,'; I := I + 1;
  Lines[I] := '    [string]$ErrFile,'; I := I + 1;
  Lines[I] := '    [string]$SupervisorsCsv'; I := I + 1;
  Lines[I] := ')'; I := I + 1;
  Lines[I] := '$ErrorActionPreference = "Continue"'; I := I + 1;
  Lines[I] := '$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'; I := I + 1;
  Lines[I] := 'function New-CryptoHex([int]$ByteLen = 32) {'; I := I + 1;
  Lines[I] := '    $b = New-Object byte[] $ByteLen'; I := I + 1;
  Lines[I] := '    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()'; I := I + 1;
  Lines[I] := '    $rng.GetBytes($b)'; I := I + 1;
  Lines[I] := '    $rng.Dispose()'; I := I + 1;
  Lines[I] := '    return ([System.BitConverter]::ToString($b)).Replace("-", "").ToLowerInvariant()'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := '$PgDataDir = Join-Path $DataDir "postgres_data"'; I := I + 1;
  Lines[I] := '$BackupDir = Join-Path $DataDir "backups"'; I := I + 1;
  Lines[I] := '$LogDir    = Join-Path $DataDir "logs"'; I := I + 1;
  Lines[I] := '$AppDataSubDir = Join-Path $DataDir "data"'; I := I + 1;
  Lines[I] := '$UploadDir = Join-Path $DataDir "uploads"'; I := I + 1;
  Lines[I] := '$EnvPath   = Join-Path $DataDir ".env"'; I := I + 1;
  Lines[I] := 'foreach ($d in @($DataDir, $PgDataDir, $BackupDir, $LogDir, $AppDataSubDir, $UploadDir, (Join-Path $UploadDir "incident-proofs"))) {'; I := I + 1;
  Lines[I] := '    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := 'Start-Transcript -Path (Join-Path $LogDir "post-install.log") -Append -ErrorAction SilentlyContinue | Out-Null'; I := I + 1;
  Lines[I] := 'if ($IsAdmin) { & icacls.exe $LogDir /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q | Out-Null }'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '# 1. Generate or update .env without ever logging secrets'; I := I + 1;
  Lines[I] := '$ExistingVars = [ordered]@{}'; I := I + 1;
  Lines[I] := 'if (Test-Path $EnvPath) {'; I := I + 1;
  Lines[I] := '    foreach ($raw in (Get-Content $EnvPath -ErrorAction SilentlyContinue)) {'; I := I + 1;
  Lines[I] := '        $line = $raw.Trim()'; I := I + 1;
  Lines[I] := '        if (-not $line -or $line.StartsWith("#")) { continue }'; I := I + 1;
  Lines[I] := '        $idx = $line.IndexOf("=")'; I := I + 1;
  Lines[I] := '        if ($idx -le 0) { continue }'; I := I + 1;
  Lines[I] := '        $k = $line.Substring(0, $idx).Trim()'; I := I + 1;
  Lines[I] := '        $v = $line.Substring($idx + 1).Trim().Trim(''"'').Trim("''")'; I := I + 1;
  Lines[I] := '        $ExistingVars[$k] = $v'; I := I + 1;
  Lines[I] := '    }'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '$Defaults = [ordered]@{'; I := I + 1;
  Lines[I] := '    "NODE_ENV"             = "production"'; I := I + 1;
  Lines[I] := '    "TZ"                   = "Asia/Manila"'; I := I + 1;
  Lines[I] := '    "DATABASE_URL"         = "postgresql://postgres:postgres@127.0.0.1:5432/company_phone_tracker?pgbouncer=true&connection_limit=1"'; I := I + 1;
  Lines[I] := '    "PGHOST"               = "127.0.0.1"'; I := I + 1;
  Lines[I] := '    "PGPORT"               = "5432"'; I := I + 1;
  Lines[I] := '    "PG_CONTROL_PORT"      = "54320"'; I := I + 1;
  Lines[I] := '    "PG_DATA_DIR"          = $PgDataDir'; I := I + 1;
  Lines[I] := '    "BACKUP_DIR"           = $BackupDir'; I := I + 1;
  Lines[I] := '    "LOG_DIR"              = $LogDir'; I := I + 1;
  Lines[I] := '    "DATA_DIR"             = $AppDataSubDir'; I := I + 1;
  Lines[I] := '    "UPLOAD_DIR"           = $UploadDir'; I := I + 1;
  Lines[I] := '    "ENV_FILE_PATH"        = $EnvPath'; I := I + 1;
  Lines[I] := '    "PORT"                 = "5000"'; I := I + 1;
  Lines[I] := '    "APP_HOST"             = if ($AppHost) { $AppHost } else { "0.0.0.0" }'; I := I + 1;
  Lines[I] := '    "APP_URL"              = $AppUrl'; I := I + 1;
  Lines[I] := '    "AGENT_HOST"           = "127.0.0.1"'; I := I + 1;
  Lines[I] := '    "AGENT_PORT"           = "8002"'; I := I + 1;
  Lines[I] := '    "KIOSK_CODE"           = if ($KioskCode) { $KioskCode } else { "PHONE-KIOSK-01" }'; I := I + 1;
  Lines[I] := '    "KIOSK_USERNAME"       = if ($KioskUser) { $KioskUser } else { "KioskUser" }'; I := I + 1;
  Lines[I] := '    "BACKUP_MIRROR_DIR"    = $BackupMirrorDir'; I := I + 1;
  Lines[I] := '    "SESSION_SECRET"       = (New-CryptoHex 32)'; I := I + 1;
  Lines[I] := '    "KIOSK_DEVICE_SECRET"  = (New-CryptoHex 32)'; I := I + 1;
  Lines[I] := '    "AGENT_PAIRING_SECRET" = (New-CryptoHex 32)'; I := I + 1;
  Lines[I] := '    "DEPLOYMENT_ID"        = "cpt-deploy-" + (New-CryptoHex 16)'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := 'if ($IsUpgrade -ne "1") {'; I := I + 1;
  Lines[I] := '    $FinalVars = [ordered]@{}'; I := I + 1;
  Lines[I] := '    foreach ($k in $Defaults.Keys) { $FinalVars[$k] = $Defaults[$k] }'; I := I + 1;
  Lines[I] := '    foreach ($secretKey in @("SESSION_SECRET", "KIOSK_DEVICE_SECRET", "AGENT_PAIRING_SECRET", "DEPLOYMENT_ID")) {'; I := I + 1;
  Lines[I] := '        if ($ExistingVars.Contains($secretKey) -and (-not [string]::IsNullOrWhiteSpace($ExistingVars[$secretKey]))) {'; I := I + 1;
  Lines[I] := '            $FinalVars[$secretKey] = $ExistingVars[$secretKey]'; I := I + 1;
  Lines[I] := '        }'; I := I + 1;
  Lines[I] := '    }'; I := I + 1;
  Lines[I] := '} else {'; I := I + 1;
  Lines[I] := '    $FinalVars = [ordered]@{}'; I := I + 1;
  Lines[I] := '    foreach ($k in $ExistingVars.Keys) { $FinalVars[$k] = $ExistingVars[$k] }'; I := I + 1;
  Lines[I] := '    foreach ($k in $Defaults.Keys) {'; I := I + 1;
  Lines[I] := '        if (-not $FinalVars.Contains($k) -or ([string]::IsNullOrWhiteSpace($FinalVars[$k]) -and $k -ne "BACKUP_MIRROR_DIR" -and $k -ne "APP_URL")) {'; I := I + 1;
  Lines[I] := '            $FinalVars[$k] = $Defaults[$k]'; I := I + 1;
  Lines[I] := '        }'; I := I + 1;
  Lines[I] := '    }'; I := I + 1;
  Lines[I] := '    if ($AppUrl -and $AppUrl -notmatch "localhost|127\.0\.0\.1") {'; I := I + 1;
  Lines[I] := '        $CurAppUrl = [string]$FinalVars["APP_URL"]'; I := I + 1;
  Lines[I] := '        $AllLocalIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)'; I := I + 1;
  Lines[I] := '        $ShouldUpdateUrl = [string]::IsNullOrWhiteSpace($CurAppUrl) -or ($CurAppUrl -match "localhost|127\.0\.0\.1")'; I := I + 1;
  Lines[I] := '        if (-not $ShouldUpdateUrl -and $CurAppUrl -match "^https?://(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?") {'; I := I + 1;
  Lines[I] := '            if ($AllLocalIps.Count -gt 0 -and ($AllLocalIps -notcontains $Matches[1])) { $ShouldUpdateUrl = $true }'; I := I + 1;
  Lines[I] := '        }'; I := I + 1;
  Lines[I] := '        if ($ShouldUpdateUrl) { $FinalVars["APP_URL"] = $AppUrl }'; I := I + 1;
  Lines[I] := '    }'; I := I + 1;
  Lines[I] := '    if ($FinalVars["KIOSK_CODE"] -eq "KIOSK-01") { $FinalVars["KIOSK_CODE"] = "PHONE-KIOSK-01" }'; I := I + 1;
  Lines[I] := '    $FinalVars["AGENT_HOST"] = "127.0.0.1"'; I := I + 1;
  Lines[I] := '    $FinalVars["NODE_ENV"] = "production"'; I := I + 1;
  Lines[I] := '    $FinalVars["TZ"] = "Asia/Manila"'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '$EnvOut = foreach ($k in $FinalVars.Keys) { "$k=`"$($FinalVars[$k])`"" }'; I := I + 1;
  Lines[I] := 'Set-Content -Path $EnvPath -Value ($EnvOut -join [Environment]::NewLine) -Encoding UTF8'; I := I + 1;
  Lines[I] := 'Set-Content -Path (Join-Path $AppDir ".env") -Value ($EnvOut -join [Environment]::NewLine) -Encoding UTF8 -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := 'foreach ($k in $FinalVars.Keys) { [Environment]::SetEnvironmentVariable($k, $FinalVars[$k], "Process") }'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '# 2. Generate kiosk-boot\config.js'; I := I + 1;
  Lines[I] := '$BootConfigPath = Join-Path $AppDir "kiosk-boot\config.js"'; I := I + 1;
  Lines[I] := '$DeviceSecret = $FinalVars["KIOSK_DEVICE_SECRET"]'; I := I + 1;
  Lines[I] := '$CfgLines = @('; I := I + 1;
  Lines[I] := '    "// Local kiosk device configuration (auto-generated by installer).",'; I := I + 1;
  Lines[I] := '    "window.CPT_KIOSK_CONFIG = {",'; I := I + 1;
  Lines[I] := '    "  baseUrl: `"http://localhost:5000`",",'; I := I + 1;
  Lines[I] := '    "  deviceKey: `"$DeviceSecret`",",'; I := I + 1;
  Lines[I] := '    "};",'; I := I + 1;
  Lines[I] := '    "window.KIOSK_DEVICE_SECRET = window.CPT_KIOSK_CONFIG.deviceKey;"'; I := I + 1;
  Lines[I] := ')'; I := I + 1;
  Lines[I] := 'Set-Content -Path $BootConfigPath -Value ($CfgLines -join [Environment]::NewLine) -Encoding UTF8'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '$NodeExe = Join-Path $AppDir "node\node.exe"'; I := I + 1;
  Lines[I] := '$InstallServicesPs1 = Join-Path $AppDir "scripts\install-services.ps1"'; I := I + 1;
  Lines[I] := '$EffectiveKioskUser = $FinalVars["KIOSK_USERNAME"]'; I := I + 1;
  Lines[I] := 'if ($IsAdmin) {'; I := I + 1;
  Lines[I] := '    # 3. Set Windows Time Zone to Standard Manila Time (UTC+08:00), sync clock, open Firewall TCP 5000, apply power settings & policies'; I := I + 1;
  Lines[I] := '    & tzutil.exe /s "Singapore Standard Time" *> $null'; I := I + 1;
  Lines[I] := '    Set-Service -Name "W32Time" -StartupType Automatic -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    Start-Service -Name "W32Time" -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    & w32tm.exe /resync /force *> $null'; I := I + 1;
  Lines[I] := '    & netsh.exe advfirewall firewall delete rule name="Company Phone Tracker Web (TCP 5000)" *> $null'; I := I + 1;
  Lines[I] := '    & netsh.exe advfirewall firewall add rule name="Company Phone Tracker Web (TCP 5000)" dir=in action=allow protocol=TCP localport=5000 profile=any *> $null'; I := I + 1;
  Lines[I] := '    & netsh.exe advfirewall firewall delete rule name="Company Phone Tracker Node Runtime" *> $null'; I := I + 1;
  Lines[I] := '    & netsh.exe advfirewall firewall add rule name="Company Phone Tracker Node Runtime" dir=in action=allow program="$NodeExe" profile=any *> $null'; I := I + 1;
  Lines[I] := '    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control" -Name "WaitToKillServiceTimeout" -Value "20000" -Type String -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" -Force -ErrorAction SilentlyContinue | Out-Null'; I := I + 1;
  Lines[I] := '    Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" -Name "NoToastApplicationNotification" -Value 1 -Type DWord -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" -Name "NoToastApplicationNotificationOnLockScreen" -Value 1 -Type DWord -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer" -Force -ErrorAction SilentlyContinue | Out-Null'; I := I + 1;
  Lines[I] := '    Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer" -Name "DisableNotificationCenter" -Value 1 -Type DWord -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    & powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 *> $null'; I := I + 1;
  Lines[I] := '    & powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba4d5a0 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 *> $null'; I := I + 1;
  Lines[I] := '    & powercfg.exe /change monitor-timeout-ac 0 *> $null'; I := I + 1;
  Lines[I] := '    & powercfg.exe /change standby-timeout-ac 0 *> $null'; I := I + 1;
  Lines[I] := '    & powercfg.exe /SETACTIVE SCHEME_CURRENT *> $null'; I := I + 1;
  Lines[I] := '    # 4. Register services & tasks via install-services.ps1 (-SkipBuild -NoStart first so we can verify prisma db push)'; I := I + 1;
  Lines[I] := '    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $InstallServicesPs1 -NodePath $NodeExe -DataDir $DataDir -EnvFilePath $EnvPath -KioskUser $EffectiveKioskUser -SkipBuild -NoStart'; I := I + 1;
  Lines[I] := '    # 5. Start CPT_DB'; I := I + 1;
  Lines[I] := '    Start-Service -Name "CPT_DB"'; I := I + 1;
  Lines[I] := '} else {'; I := I + 1;
  Lines[I] := '    Write-Host "[CurrentUser Mode] Stopping any existing node.exe instances in $AppDir..."'; I := I + 1;
  Lines[I] := '    try { Invoke-WebRequest -Uri "http://127.0.0.1:54320/shutdown" -Method Post -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null; Start-Sleep -Seconds 1 } catch {}'; I := I + 1;
  Lines[I] := '    try {'; I := I + 1;
  Lines[I] := '        $procs = @(Get-CimInstance Win32_Process -Filter "Name = ''node.exe''" -ErrorAction SilentlyContinue)'; I := I + 1;
  Lines[I] := '        foreach ($p in $procs) {'; I := I + 1;
  Lines[I] := '            if ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($AppDir, [System.StringComparison]::OrdinalIgnoreCase)) {'; I := I + 1;
  Lines[I] := '                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '            }'; I := I + 1;
  Lines[I] := '        }'; I := I + 1;
  Lines[I] := '    } catch {}'; I := I + 1;
  Lines[I] := '    $UserRunnerPs1 = Join-Path $AppDir "scripts\start-user-services.ps1"'; I := I + 1;
  Lines[I] := '    $UserRunnerVbs = Join-Path $AppDir "scripts\start-user-services.vbs"'; I := I + 1;
  Lines[I] := '    $RunnerLines = @('; I := I + 1;
  Lines[I] := '        "`$AppDir = `"$AppDir`"",'; I := I + 1;
  Lines[I] := '        "`$NodeExe = Join-Path `$AppDir `"node\node.exe`"",'; I := I + 1;
  Lines[I] := '        "`$env:ENV_FILE_PATH = `"$EnvPath`"",'; I := I + 1;
  Lines[I] := '        "Start-Process -FilePath `$NodeExe -ArgumentList (Join-Path `$AppDir `"scripts\db-server.mjs`") -WorkingDirectory `$AppDir -WindowStyle Hidden",'; I := I + 1;
  Lines[I] := '        "& `$NodeExe (Join-Path `$AppDir `"scripts\wait-for-pg.mjs`")",'; I := I + 1;
  Lines[I] := '        "Start-Process -FilePath `$NodeExe -ArgumentList (Join-Path `$AppDir `"agent\reader-agent.mjs`") -WorkingDirectory `$AppDir -WindowStyle Hidden",'; I := I + 1;
  Lines[I] := '        "Start-Process -FilePath `$NodeExe -ArgumentList (Join-Path `$AppDir `"scripts\overdue-worker.mjs`") -WorkingDirectory `$AppDir -WindowStyle Hidden",'; I := I + 1;
  Lines[I] := '        "Start-Process -FilePath `$NodeExe -ArgumentList (Join-Path `$AppDir `"server.js`") -WorkingDirectory `$AppDir -WindowStyle Hidden"'; I := I + 1;
  Lines[I] := '    )'; I := I + 1;
  Lines[I] := '    Set-Content -Path $UserRunnerPs1 -Value ($RunnerLines -join [Environment]::NewLine) -Encoding UTF8'; I := I + 1;
  Lines[I] := '    $VbsContent = "CreateObject(`"WScript.Shell`").Run `"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"`"$UserRunnerPs1`"`"`", 0, False"'; I := I + 1;
  Lines[I] := '    Set-Content -Path $UserRunnerVbs -Value $VbsContent -Encoding ASCII'; I := I + 1;
  Lines[I] := '    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CPT_Services" -Value "wscript.exe `"$UserRunnerVbs`"" -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    Start-Process -FilePath $NodeExe -ArgumentList (Join-Path $AppDir "scripts\db-server.mjs") -WorkingDirectory $AppDir -WindowStyle Hidden'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := '& $NodeExe (Join-Path $AppDir "scripts\wait-for-pg.mjs")'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '$PrismaCli = Join-Path $AppDir "node_modules\prisma\build\index.js"'; I := I + 1;
  Lines[I] := '$SchemaPath = Join-Path $AppDir "prisma\schema.prisma"'; I := I + 1;
  Lines[I] := 'Push-Location $AppDir'; I := I + 1;
  Lines[I] := '$PrismaOutput = $null | & $NodeExe $PrismaCli db push --skip-generate --schema="$SchemaPath" 2>&1 | Out-String'; I := I + 1;
  Lines[I] := '$PrismaExit = $LASTEXITCODE'; I := I + 1;
  Lines[I] := 'Pop-Location'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '$WouldLoseData = ($PrismaExit -ne 0) -or ($PrismaOutput -match "accept-data-loss|there might be data loss|data loss")'; I := I + 1;
  Lines[I] := 'if ($WouldLoseData -and $IsUpgrade -eq "1") {'; I := I + 1;
  Lines[I] := '    $ErrMsg = "Upgrade aborted: prisma db push failed or detected potential data loss (exit=$PrismaExit).`r`n`r`n$PrismaOutput"'; I := I + 1;
  Lines[I] := '    Set-Content -Path $ErrFile -Value $ErrMsg -Encoding UTF8'; I := I + 1;
  Lines[I] := '    try { Invoke-WebRequest -Uri "http://127.0.0.1:54320/shutdown" -Method Post -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null; Start-Sleep -Seconds 2 } catch {}'; I := I + 1;
  Lines[I] := '    if ($IsAdmin) { Stop-Service -Name "CPT_DB" -Force -ErrorAction SilentlyContinue }'; I := I + 1;
  Lines[I] := '    Start-Sleep -Seconds 2'; I := I + 1;
  Lines[I] := '    $PrevDir = Join-Path $AppDir "_previous"'; I := I + 1;
  Lines[I] := '    if (Test-Path $PrevDir) {'; I := I + 1;
  Lines[I] := '        $CurItems = @(Get-ChildItem -Path $AppDir -Force | Where-Object { $_.Name -ne "_previous" -and $_.Name -notlike "unins*" })'; I := I + 1;
  Lines[I] := '        foreach ($ci in $CurItems) { Remove-Item -Path $ci.FullName -Recurse -Force -ErrorAction SilentlyContinue }'; I := I + 1;
  Lines[I] := '        $OldItems = @(Get-ChildItem -Path $PrevDir -Force)'; I := I + 1;
  Lines[I] := '        foreach ($oi in $OldItems) { Move-Item -Path $oi.FullName -Destination (Join-Path $AppDir $oi.Name) -Force -ErrorAction SilentlyContinue }'; I := I + 1;
  Lines[I] := '        if ($IsAdmin) { & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $InstallServicesPs1 -NodePath $NodeExe -DataDir $DataDir -EnvFilePath $EnvPath -KioskUser $EffectiveKioskUser -SkipBuild }'; I := I + 1;
  Lines[I] := '    }'; I := I + 1;
  Lines[I] := '    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null'; I := I + 1;
  Lines[I] := '    exit 42'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '# 6. Seed kiosk account & core roles, bulk import supervisors if provided, then start all remaining services'; I := I + 1;
  Lines[I] := 'Remove-Item -Path (Join-Path $AppDir ".next\server\route-cache") -Recurse -Force -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := 'Remove-Item -Path (Join-Path $AppDir ".next\cache") -Recurse -Force -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := 'Push-Location $AppDir'; I := I + 1;
  Lines[I] := '& $NodeExe (Join-Path $AppDir "scripts\seed-kiosk-account.mjs")'; I := I + 1;
  Lines[I] := 'if ($SupervisorsCsv -and (Test-Path $SupervisorsCsv)) {'; I := I + 1;
  Lines[I] := '    & $NodeExe (Join-Path $AppDir "scripts\import-supervisors.mjs") --file="$SupervisorsCsv"'; I := I + 1;
  Lines[I] := '} else {'; I := I + 1;
  Lines[I] := '    & $NodeExe (Join-Path $AppDir "scripts\import-supervisors.mjs")'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := 'Pop-Location'; I := I + 1;
  Lines[I] := 'if ($IsAdmin) {'; I := I + 1;
  Lines[I] := '    Start-Service -Name "CPT_Agent"'; I := I + 1;
  Lines[I] := '    Start-Service -Name "CPT_Worker"'; I := I + 1;
  Lines[I] := '    Start-Service -Name "CPT_Web"'; I := I + 1;
  Lines[I] := '} else {'; I := I + 1;
  Lines[I] := '    Start-Process -FilePath $NodeExe -ArgumentList (Join-Path $AppDir "agent\reader-agent.mjs") -WorkingDirectory $AppDir -WindowStyle Hidden'; I := I + 1;
  Lines[I] := '    Start-Process -FilePath $NodeExe -ArgumentList (Join-Path $AppDir "scripts\overdue-worker.mjs") -WorkingDirectory $AppDir -WindowStyle Hidden'; I := I + 1;
  Lines[I] := '    Start-Process -FilePath $NodeExe -ArgumentList (Join-Path $AppDir "server.js") -WorkingDirectory $AppDir -WindowStyle Hidden'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '# 7. Wait for /api/health database UP'; I := I + 1;
  Lines[I] := 'for ($attempt = 1; $attempt -le 40; $attempt++) {'; I := I + 1;
  Lines[I] := '    try {'; I := I + 1;
  Lines[I] := '        $resp = Invoke-WebRequest -Uri "http://localhost:5000/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop'; I := I + 1;
  Lines[I] := '        if ($resp.StatusCode -eq 200) {'; I := I + 1;
  Lines[I] := '            $json = $resp.Content | ConvertFrom-Json'; I := I + 1;
  Lines[I] := '            if ($json.checks.database.status -eq "UP") { break }'; I := I + 1;
  Lines[I] := '        }'; I := I + 1;
  Lines[I] := '    } catch {}'; I := I + 1;
  Lines[I] := '    Start-Sleep -Milliseconds 1500'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '# 8. Create admin account on first install using temp file (deleted immediately in finally block)'; I := I + 1;
  Lines[I] := 'try {'; I := I + 1;
  Lines[I] := '    if ($IsUpgrade -ne "1" -and (Test-Path $PwTempFile) -and (-not [string]::IsNullOrWhiteSpace($AdminEmail))) {'; I := I + 1;
  Lines[I] := '        Push-Location $AppDir'; I := I + 1;
  Lines[I] := '        & $NodeExe (Join-Path $AppDir "scripts\create-admin.mjs") --email="$AdminEmail" --name="$AdminName" --password-file="$PwTempFile"'; I := I + 1;
  Lines[I] := '        & $NodeExe (Join-Path $AppDir "scripts\seed-kiosk-account.mjs")'; I := I + 1;
  Lines[I] := '        Pop-Location'; I := I + 1;
  Lines[I] := '    }'; I := I + 1;
  Lines[I] := '} finally {'; I := I + 1;
  Lines[I] := '    if (Test-Path $PwTempFile) {'; I := I + 1;
  Lines[I] := '        Set-Content -Path $PwTempFile -Value ("0" * 128) -Encoding ASCII -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '        Remove-Item -Path $PwTempFile -Force -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := '    }'; I := I + 1;
  Lines[I] := '}'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '# 9. Take a fresh backup snapshot so /api/health and release-check.mjs see a current (<1h) backup'; I := I + 1;
  Lines[I] := 'Push-Location $AppDir'; I := I + 1;
  Lines[I] := '& $NodeExe (Join-Path $AppDir "scripts\backup-db.mjs")'; I := I + 1;
  Lines[I] := ''; I := I + 1;
  Lines[I] := '# 10. Run release-check.mjs and save output for final wizard page'; I := I + 1;
  Lines[I] := '$ReleaseCheckOut = & $NodeExe (Join-Path $AppDir "scripts\release-check.mjs") 2>&1 | Out-String'; I := I + 1;
  Lines[I] := 'Pop-Location'; I := I + 1;
  Lines[I] := 'Set-Content -Path $SummaryFile -Value $ReleaseCheckOut -Encoding UTF8'; I := I + 1;
  Lines[I] := 'Set-Content -Path (Join-Path $LogDir "release-check-latest.log") -Value $ReleaseCheckOut -Encoding UTF8 -ErrorAction SilentlyContinue'; I := I + 1;
  Lines[I] := 'Stop-Transcript -ErrorAction SilentlyContinue | Out-Null'; I := I + 1;
  Lines[I] := 'exit 0'; I := I + 1;
  SetArrayLength(Lines, I);

  SaveStringsToUTF8FileWithoutBOM(ScriptPath, Lines, False);

  CmdArgs :=
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass' +
    ' -File "' + ScriptPath + '"' +
    ' -AppDir "' + AppDir + '"' +
    ' -DataDir "' + DataDir + '"' +
    ' -IsUpgrade "' + IsUpgradeFlag + '"' +
    ' -KioskCode "' + KioskCodeVal + '"' +
    ' -AppHost "' + AppHostVal + '"' +
    ' -AppUrl "' + AppUrlVal + '"' +
    ' -KioskUser "' + KioskUserVal + '"' +
    ' -BackupMirrorDir "' + BackupMirrorVal + '"' +
    ' -AdminEmail "' + AdminEmailVal + '"' +
    ' -AdminName "' + AdminNameVal + '"' +
    ' -PwTempFile "' + PwTempFile + '"' +
    ' -SummaryFile "' + SummaryFile + '"' +
    ' -ErrFile "' + ErrFile + '"' +
    ' -SupervisorsCsv "' + SupervisorsCsvVal + '"';

  Log('Running post-install provisioning, service start, and release-check.mjs...');
  Exec('powershell.exe', CmdArgs, AppDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Always ensure temp password file is deleted
  if FileExists(PwTempFile) then
    DeleteFile(PwTempFile);
  if FileExists(ScriptPath) then
    DeleteFile(ScriptPath);

  if ResultCode = 42 then
  begin
    UpgradeFailedAndRolledBack := True;
    if FileExists(ErrFile) and LoadStringsFromFile(ErrFile, ErrLines) then
    begin
      UpgradeFailureMessage := '';
      for I := 0 to GetArrayLength(ErrLines) - 1 do
        UpgradeFailureMessage := UpgradeFailureMessage + ErrLines[I] + #13#10;
    end
    else
      UpgradeFailureMessage := 'Database schema push (prisma db push) failed or required data loss. Rolled back to _previous version.';

    Log('ERROR: ' + UpgradeFailureMessage);
    SuppressibleMsgBox(
      'Upgrade Aborted & Rolled Back Automatically:' + #13#10 + #13#10 +
      UpgradeFailureMessage + #13#10 +
      'The previous application version from _previous has been restored and services have been restarted.',
      mbCriticalError, MB_OK, IDOK
    );
  end;

  if FileExists(SummaryFile) and LoadStringsFromFile(SummaryFile, SummaryLines) then
  begin
    ReleaseCheckSummaryText := '';
    ReleaseCheckMemo.Lines.Clear;
    for I := 0 to GetArrayLength(SummaryLines) - 1 do
    begin
      ReleaseCheckMemo.Lines.Add(SummaryLines[I]);
      ReleaseCheckSummaryText := ReleaseCheckSummaryText + SummaryLines[I] + #13#10;
    end;
    Log('release-check.mjs output:' + #13#10 + ReleaseCheckSummaryText);
    DeleteFile(SummaryFile);
  end
  else if UpgradeFailedAndRolledBack then
  begin
    ReleaseCheckMemo.Lines.Text := UpgradeFailureMessage;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssInstall) and IsUpgradeInstall then
  begin
    RunPreUpgradeBackupAndArchive();
  end
  else if CurStep = ssPostInstall then
  begin
    RunPostInstallConfiguration();
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    WizardForm.FinishedLabel.Caption :=
      'Company Phone Tracker ({#MyAppVersion}) deployment completed. Below is the automated verification summary from scripts\release-check.mjs:';
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppDir, DataDir, UninstallScript, CmdArgs: String;
  ResultCode: Integer;
  DeleteDataAnswer: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    AppDir := ExpandConstant('{app}');
    DataDir := GetDataDir('');
    UninstallScript := AppDir + '\scripts\uninstall-services.ps1';

    if FileExists(UninstallScript) then
    begin
      CmdArgs := Format('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%s"', [UninstallScript]);
      Log('Stopping and removing NSSM services and scheduled tasks via uninstall-services.ps1...');
      Exec('powershell.exe', CmdArgs, AppDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Log(Format('uninstall-services.ps1 exited with code %d', [ResultCode]));
    end;

    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'CPT_Services');

    // Clean up generated config.js and _previous archive
    DeleteFile(AppDir + '\.env');
    DeleteFile(AppDir + '\kiosk-boot\config.js');
    DeleteFile(AppDir + '\scripts\start-user-services.ps1');
    DeleteFile(AppDir + '\scripts\start-user-services.vbs');
    if DirExists(AppDir + '\_previous') then
      DelTree(AppDir + '\_previous', True, True, True);

    // Ask whether to keep or delete DataDir (default: keep / IDNO)
    if DirExists(DataDir) then
    begin
      DeleteDataAnswer := SuppressibleMsgBox(
        'Do you want to DELETE all database records, backups, logs, uploads, and configuration in ' + DataDir + '?' + #13#10 + #13#10 +
        'Click "No" (Default / Recommended) to KEEP your data in ' + DataDir + '.' + #13#10 +
        'Click "Yes" to PERMANENTLY DELETE ' + DataDir + '.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO
      );
      if DeleteDataAnswer = IDYES then
      begin
        Log('User chose to delete ' + DataDir + '.');
        DelTree(DataDir, True, True, True);
      end
      else
      begin
        Log('Keeping ' + DataDir + ' (default).');
      end;
    end;
  end;
end;
