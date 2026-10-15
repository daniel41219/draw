; Instalador do Draw para Windows (Inno Setup 6)
; Instala só para o usuário atual (sem pedir administrador), cria atalhos e desinstalador.
#define AppName "Draw"
#define AppVersion "1.0.0"
#define AppExe "Draw.exe"

[Setup]
AppId={{F297D0EC-3F1C-4D2F-A12D-ACB137448AD3}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Draw
AppPublisherURL=https://draw.mais.live
AppSupportURL=https://draw.mais.live
AppComments=Editor vetorial com as ferramentas e os atalhos do CorelDRAW
DefaultDirName={localappdata}\Programs\Draw
DefaultGroupName=Draw
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\..\draw-site\downloads
OutputBaseFilename=Draw-Setup
SetupIconFile=draw.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Instalador do Draw
VersionInfoProductName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\Draw\Draw-win_x64.exe"; DestDir: "{app}"; DestName: "{#AppExe}"; Flags: ignoreversion
Source: "draw.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\draw.ico"; Comment: "Editor vetorial"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\draw.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
// O Draw usa o Microsoft Edge WebView2, que já vem no Windows 10 e 11 atualizados
function WebView2Installed(): Boolean;
var v: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v)
         or RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
  if Result then Result := (v <> '') and (v <> '0.0.0.0');
end;

function InitializeSetup(): Boolean;
var code: Integer;
begin
  Result := True;
  if not WebView2Installed() then
    if MsgBox('O Draw precisa do Microsoft Edge WebView2, que vem no Windows 10 e 11 atualizados, mas ele não foi encontrado neste computador.' + #13#10#13#10 +
              'Abrir a página da Microsoft para instalar o WebView2? Depois, rode este instalador de novo.', mbConfirmation, MB_YESNO) = IDYES then
    begin
      ShellExec('open', 'https://go.microsoft.com/fwlink/p/?LinkId=2124703', '', '', SW_SHOWNORMAL, ewNoWait, code);
      Result := False;
    end;
end;
