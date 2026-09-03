"use client";
import React, { useState, useEffect } from 'react';

export default function IngestionPage() {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [showToast, setShowToast] = useState(false);
    const [mappingConfirmed, setMappingConfirmed] = useState(false);

    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        setUploadProgress(25);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`http://localhost:8000/api/upload-telemetry`, {
                method: 'POST',
                body: formData,
            });
            
            const data = await res.json();
            
            if (res.ok) {
                setUploadProgress(100);
                setTimeout(() => setIsUploading(false), 500);
                alert(data.message || 'File uploaded successfully!');
            } else {
                throw new Error(data.detail || 'Upload failed');
            }
        } catch (error: any) {
            console.error(error);
            alert(`Error: ${error.message}`);
            setIsUploading(false);
            setUploadProgress(0);
        }
        
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleConfirmMapping = () => {
        setMappingConfirmed(true);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
    };

    return (
        <>
<div className="max-w-[1440px] mx-auto px-container-padding py-stack-lg flex flex-col gap-stack-lg">
{/*  Page Header  */}
<div>
<h1 className="font-headline-md text-headline-md text-primary">Ingestion Engine</h1>
<p className="font-body-md text-body-md text-on-surface-variant mt-1">Configure sources and train semantic models.</p>
</div>
{/*  Ingestion Drop Zone  */}
<section className="bg-surface-container-lowest border border-outline-variant rounded p-stack-lg text-center border-dashed relative overflow-hidden transition-colors" id="drop-zone">
<div className="max-w-md mx-auto">
<span className="material-symbols-outlined text-[48px] text-outline mb-stack-md" data-icon="cloud_upload" style={{fontVariationSettings: "'wght' 200"}}>cloud_upload</span>
<h2 className="font-title-lg text-title-lg text-primary mb-2">Upload Configuration Files</h2>
<p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">Drag and drop raw text files, JSON configs, or connect directly to a cloud repository.</p>
<div className="flex items-center justify-center gap-stack-md">
<button onClick={handleUploadClick} className="border border-outline-variant text-primary font-body-sm text-body-sm px-4 py-2 rounded hover:border-primary transition-colors bg-surface-container-lowest">
                                Browse Files
                            </button>
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                style={{ display: 'none' }} 
                                accept=".json,.txt"
                                onChange={handleFileChange}
                            />
<span className="font-body-sm text-body-sm text-on-surface-variant">or</span>
<button onClick={handleUploadClick} className="bg-primary text-on-primary font-body-sm text-body-sm px-4 py-2 rounded hover:opacity-90 transition-opacity flex items-center gap-2">
<span className="material-symbols-outlined text-[16px]" data-icon="cable">cable</span>
                                Cloud Connection
                            </button>
</div>
</div>
{/*  Progress Bar (Simulated Active State)  */}
<div className={`absolute bottom-0 left-0 w-full h-1 bg-surface-container-high transition-opacity duration-300 ${isUploading ? 'opacity-100' : 'opacity-0'}`}>
<div className="h-full bg-primary transition-all duration-200 ease-out" style={{ width: `${uploadProgress}%` }}></div>
</div>
</section>
{/*  Interactive Training Loop Split Screen  */}
<section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter h-[600px]">
{/*  Left: Raw Input  */}
<div className="flex flex-col border border-outline-variant rounded bg-surface-container-lowest overflow-hidden">
<div className="bg-surface-container px-4 py-2 border-b border-outline-variant flex justify-between items-center">
<span className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-2">
<span className="material-symbols-outlined text-[16px]" data-icon="terminal">terminal</span>
                                Raw Input Stream
                            </span>
<span className="font-data-mono text-data-mono text-[11px] text-outline">SONiC_CORE_04.txt</span>
</div>
<div className="flex-1 bg-[#1e293b] p-4 overflow-y-auto font-data-mono text-data-mono text-[13px] text-slate-300 leading-relaxed selection:bg-slate-700">
<pre><code>{`! SONiC OS Configuration
!
interface Ethernet0
 description Uplink-Core-Primary
 mtu 9100
 speed 100000
 ip address 10.0.1.1/30
!
interface Ethernet4
 description Downlink-Access-01
 mtu 1500
 `}<span className={`px-1 rounded cursor-pointer transition-colors ${mappingConfirmed ? 'bg-primary/50 text-white' : 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/40'}`}>ip verify unicast source reachable-via rx</span>{`
 switchport access vlan 10
!
bgp router-id 10.0.0.1
 router bgp 65000
  neighbor 10.0.1.2 remote-as 65001
  neighbor 10.0.1.2 description Core-Router-B
!`}</code></pre>
</div>
</div>
{/*  Right: Mapping Canvas  */}
<div className="flex flex-col border border-outline-variant rounded bg-surface-container-lowest overflow-hidden">
<div className="bg-surface-container px-4 py-2 border-b border-outline-variant flex justify-between items-center">
<span className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-2">
<span className="material-symbols-outlined text-[16px]" data-icon="schema">schema</span>
                                Semantic Mapping
                            </span>
<button aria-label="Auto-map" className="text-primary hover:opacity-70 transition-opacity">
<span className="material-symbols-outlined text-[18px]" data-icon="auto_awesome">auto_awesome</span>
</button>
</div>
<div className="flex-1 p-stack-md overflow-y-auto bg-surface-bright flex flex-col gap-stack-md">
<div className="font-body-sm text-body-sm text-on-surface-variant mb-2">Map selected raw input to standard compliance parameters to train the ingestion model.</div>
{/*  Mapping Block  */}
<div className="border border-outline-variant rounded p-4 bg-surface-container-lowest shadow-sm code-input-glow transition-all">
<div className="font-data-mono text-data-mono text-primary bg-surface-container px-2 py-1 rounded inline-block mb-3 border border-outline-variant">
                                    ip verify unicast source reachable-via rx
                                </div>
<div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-center">
<label className="font-label-caps text-label-caps text-on-surface-variant text-right">Parameter</label>
<div className="relative">
<select defaultValue="URPF" className="w-full appearance-none bg-surface border-b border-outline-variant py-2 pl-2 pr-8 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary focus:border-b-2 rounded-t transition-colors cursor-pointer">
<option value="Select">Select standard parameter...</option>
<option value="URPF">Enforce Anti-Spoofing (URPF)</option>
<option value="MTU">Interface MTU Enforcement</option>
<option value="BGP">BGP Neighbor Authentication</option>
</select>
<span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" data-icon="arrow_drop_down">arrow_drop_down</span>
</div>
<label className="font-label-caps text-label-caps text-on-surface-variant text-right">Risk Tag</label>
<div className="flex gap-2">
<span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-label-caps bg-secondary-container text-on-secondary-container">Data Integrity</span>
<button className="inline-flex items-center justify-center w-6 h-6 rounded border border-outline-variant text-outline hover:text-primary hover:border-primary transition-colors">
<span className="material-symbols-outlined text-[14px]" data-icon="add">add</span>
</button>
</div>
<label className="font-label-caps text-label-caps text-on-surface-variant text-right">Confidence</label>
<div className="flex items-center gap-3">
<div className="flex-1 h-1 bg-surface-variant rounded-full overflow-hidden">
<div className="h-full bg-primary w-[85%]"></div>
</div>
<span className="font-data-mono text-data-mono text-on-surface-variant">85%</span>
</div>
</div>
<div className="mt-4 flex justify-end gap-2 border-t border-outline-variant pt-3">
<button className="font-body-sm text-body-sm px-3 py-1.5 text-on-surface-variant hover:text-primary transition-colors">Ignore</button>
<button 
    onClick={handleConfirmMapping}
    className={`font-body-sm text-body-sm px-4 py-1.5 rounded transition-opacity shadow-sm ${mappingConfirmed ? 'bg-surface-variant text-on-surface-variant' : 'bg-primary text-on-primary hover:opacity-90'}`} 
    id="btn-train"
    disabled={mappingConfirmed}
>
                                        {mappingConfirmed ? 'Mapped ✓' : 'Confirm Mapping'}
                                    </button>
</div>
</div>
{/*  Empty State Block  */}
<div className="border border-dashed border-outline-variant rounded p-stack-lg flex flex-col items-center justify-center text-center bg-surface-container-lowest/50 opacity-60">
<span className="material-symbols-outlined text-[24px] text-outline mb-2" data-icon="swipe_up">swipe_up</span>
<span className="font-body-sm text-body-sm text-on-surface-variant">Select more text in the Raw Input to create another mapping.</span>
</div>
</div>
</div>
</section>
</div>
{/*  Toast Notification  */}
<div className={`fixed bottom-stack-lg right-container-padding bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded shadow-lg flex items-center gap-3 transform transition-all duration-300 z-50 ${showToast ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none'}`} id="ai-toast">
<span className="material-symbols-outlined text-[#a7f3d0]" data-icon="check_circle">check_circle</span>
<div>
<div className="font-body-sm text-body-sm font-semibold">AI Learned</div>
<div className="font-body-sm text-[12px] text-surface-dim">Mapping applied to future configurations.</div>
</div>
</div>

</>
    );
}
