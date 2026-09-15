(() => {
  "use strict";

  const config = {
    colorPrimary: "#333333",
    colorSecondary: "#275485",
    colorAccent: "#A5A4A4",
    distortionRadius: .125,
    distortionForce: .82,
    motionInfluence: .92,
    deformationPersistence: .86,
    fluidViscosity: .74,
    fluidDiffusion: .34,
    relaxationSpeed: .18,
    ambientMotionSpeed: .032,
    simulationScale: .32,
    mobileSimulationScale: .24,
    maxPixelRatio: 1.75,
    activeFrameInterval: 1000 / 60,
    idleFrameInterval: 1000 / 24,
    activeDuration: 650
  };

  class OrganicFluidBackground {
    constructor(canvas) {
      this.canvas = canvas;
      this.reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
      this.coarsePointerQuery = matchMedia("(pointer: coarse)");
      this.reducedMotion = this.reducedMotionQuery.matches;
      this.coarsePointer = this.coarsePointerQuery.matches;
      this.destroyed = false;
      this.splats = [];
      this.pointers = new Map();
      this.packedSplats = new Float32Array(96);
      this.packedVelocity = new Float32Array(48);
      this.primary = this.rgb(config.colorPrimary);
      this.secondary = this.rgb(config.colorSecondary);
      this.accent = this.rgb(config.colorAccent);
      this.targetPrimary = new Float32Array(this.primary);
      this.targetSecondary = new Float32Array(this.secondary);
      this.canvas.dataset.fluidPrimary = config.colorPrimary;
      this.canvas.dataset.fluidSecondary = config.colorSecondary;
      this.canvas.dataset.fluidAccent = config.colorAccent;
      this.canvas.style.setProperty("--fluid-primary", config.colorPrimary);
      this.canvas.style.setProperty("--fluid-secondary", config.colorSecondary);
      this.resizeQueued = true;
      this.running = false;
      this.raf = 0;
      this.frameTimer = 0;
      this.frame = this.frame.bind(this);
      this.onPointer = this.onPointer.bind(this);
      this.onPointerEnd = this.onPointerEnd.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onVisibility = this.onVisibility.bind(this);
      this.onPreferenceChange = this.onPreferenceChange.bind(this);
      this.gl = canvas.getContext("webgl2", {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: "high-performance", preserveDrawingBuffer: false
      });

      if (!this.gl) {
        canvas.dataset.renderer = "css-fallback";
        return;
      }

      try {
        this.setup();
        this.attach();
        this.resize();
        this.render();
        this.wake();
        canvas.dataset.renderer = "webgl2";
      } catch (error) {
        console.warn("El fondo fluido usa el fallback CSS.", error);
        this.destroyGL();
        canvas.style.visibility = "hidden";
        canvas.dataset.renderer = "css-fallback";
      }
    }

    setup() {
      const vertex = `#version 300 es
        in vec2 aPosition; out vec2 vUv;
        void main(){ vUv=aPosition*.5+.5; gl_Position=vec4(aPosition,0.,1.); }`;
      const simulation = `#version 300 es
        precision highp float; in vec2 vUv; out vec4 color;
        uniform sampler2D uState; uniform vec2 uTexel; uniform float uDt;
        uniform float uPersistence,uViscosity,uDiffusion,uRelaxation;
        uniform int uCount; uniform vec4 uSplats[24]; uniform vec2 uVelocity[24];
        vec2 dec(vec2 v){return v*2.-1.;} vec2 enc(vec2 v){return v*.5+.5;}
        void main(){
          vec4 previous=texture(uState,vUv); vec2 velocity=dec(previous.gb);
          vec2 back=clamp(vUv-velocity*uDt*.34,uTexel,1.-uTexel);
          vec4 center=texture(uState,back);
          vec4 l=texture(uState,back-vec2(uTexel.x,0.)); vec4 r=texture(uState,back+vec2(uTexel.x,0.));
          vec4 d=texture(uState,back-vec2(0.,uTexel.y)); vec4 u=texture(uState,back+vec2(0.,uTexel.y));
          float dye=mix(center.r,(l.r+r.r+d.r+u.r)*.25,clamp(uDiffusion*uDt*5.5,0.,.34));
          dye*=exp(-mix(1.65,.24,uPersistence)*uDt);
          velocity=mix(dec(center.gb),(dec(l.gb)+dec(r.gb)+dec(d.gb)+dec(u.gb))*.25,clamp(uViscosity*uDt*3.6,0.,.28));
          velocity*=exp(-(uRelaxation+1.24)*uDt);
          for(int i=0;i<24;i++) { if(i>=uCount) break;
            vec4 s=uSplats[i]; vec2 motion=uVelocity[i]; float speed=length(motion);
            vec2 dir=speed>.0001?motion/speed:vec2(1.,0.); vec2 perp=vec2(-dir.y,dir.x); vec2 delta=vUv-s.xy;
            float stretch=1.+min(speed*5.2,.9); float along=dot(delta,dir)/(s.w*stretch); float across=dot(delta,perp)/s.w;
            float ink=exp(-(along*along+across*across)*2.72)*s.z;
            dye=clamp(dye+ink*.18,0.,1.); velocity+=motion*ink*.32;
          }
          color=vec4(dye,enc(clamp(velocity,vec2(-.95),vec2(.95))),1.);
        }`;
      const render = `#version 300 es
        precision highp float; in vec2 vUv; out vec4 color;
        uniform sampler2D uState; uniform vec2 uResolution,uTexel; uniform vec3 uPrimary,uSecondary,uAccent;
        uniform float uTime,uAmbientSpeed;
        float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
        void main(){
          vec2 drift=vec2(uTime*uAmbientSpeed*.14,-uTime*uAmbientSpeed*.09);
          float ambient=noise(vUv*1.8+drift)*.18+noise(vUv*3.1-drift.yx)*.12;
          float dye=texture(uState,vUv).r;
          dye+=texture(uState,vUv+vec2(uTexel.x*2.,0.)).r+texture(uState,vUv-vec2(uTexel.x*2.,0.)).r;
          dye+=texture(uState,vUv+vec2(0.,uTexel.y*2.)).r+texture(uState,vUv-vec2(0.,uTexel.y*2.)).r;
          // El campo de simulación vive en una escala corta; esta curva deja
          // que la deformación active realmente el accent sin teñir el reposo.
          dye=smoothstep(.01,.18,dye*.2);
          float variation=noise(vUv*uResolution.xy/max(uResolution.y,1.)*.018+3.2+drift);
          vec3 ink=mix(uSecondary*.78,min(uSecondary*1.24,1.),variation);
          // El color principal domina el reposo; el secundario aparece en la
          // deriva y, sobre todo, dentro de la deformación del cursor.
          vec3 base=mix(uPrimary,ink,ambient*.35);
          vec3 finalColor=mix(base,ink,dye*.82);
          // El accent dibuja solo el borde de la deformación azul, no su relleno.
          float accentEdge=smoothstep(.02,.22,dye)*(1.-smoothstep(.22,.62,dye));
          finalColor=mix(finalColor,uAccent,accentEdge*.30);
          vec2 vignette=vUv*(1.-vUv.yx); finalColor*=mix(.78,1.,pow(clamp(vignette.x*vignette.y*18.,0.,1.),.14));
          color=vec4(clamp(finalColor,0.,1.),1.);
        }`;
      this.simProgram = this.program(vertex, simulation);
      this.renderProgram = this.program(vertex, render);
      this.positionLocations = new Map([
        [this.simProgram, this.gl.getAttribLocation(this.simProgram, "aPosition")],
        [this.renderProgram, this.gl.getAttribLocation(this.renderProgram, "aPosition")]
      ]);
      this.simUniforms = this.uniforms(this.simProgram);
      this.renderUniforms = this.uniforms(this.renderProgram);
      const gl = this.gl;
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    }

    shader(type, source) {
      const shader = this.gl.createShader(type);
      this.gl.shaderSource(shader, source); this.gl.compileShader(shader);
      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) throw new Error(this.gl.getShaderInfoLog(shader));
      return shader;
    }
    program(vertex, fragment) {
      const gl=this.gl, program=gl.createProgram(), vs=this.shader(gl.VERTEX_SHADER,vertex), fs=this.shader(gl.FRAGMENT_SHADER,fragment);
      gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      return program;
    }
    uniforms(program) {
      const result={}, count=this.gl.getProgramParameter(program,this.gl.ACTIVE_UNIFORMS);
      for(let i=0;i<count;i++) { const name=this.gl.getActiveUniform(program,i).name.replace("[0]",""); result[name]=this.gl.getUniformLocation(program,name); }
      return result;
    }
    target(width,height) {
      const gl=this.gl, texture=gl.createTexture(), framebuffer=gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D,texture);
      [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER].forEach(key=>gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR));
      [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T].forEach(key=>gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE));
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error("No se pudo crear el framebuffer.");
      gl.clearColor(0,.5,.5,1); gl.clear(gl.COLOR_BUFFER_BIT); return {texture,framebuffer,width,height};
    }
    resize() {
      const gl=this.gl, ratio=Math.min(devicePixelRatio||1,config.maxPixelRatio), width=Math.max(1,Math.floor(innerWidth*ratio)), height=Math.max(1,Math.floor(innerHeight*ratio));
      if(this.canvas.width!==width||this.canvas.height!==height) { this.canvas.width=width; this.canvas.height=height; }
      const scale=this.coarsePointer?config.mobileSimulationScale:config.simulationScale, sw=Math.max(96,Math.floor(innerWidth*scale)), sh=Math.max(96,Math.floor(innerHeight*scale));
      if(!this.targets||this.targets[0].width!==sw||this.targets[0].height!==sh) { this.deleteTargets(); this.targets=[this.target(sw,sh),this.target(sw,sh)]; this.readIndex=0; }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); this.resizeQueued=false;
    }
    attach() {
      window.addEventListener("pointermove",this.onPointer,{passive:true}); window.addEventListener("pointerdown",this.onPointer,{passive:true});
      window.addEventListener("pointerup",this.onPointerEnd,{passive:true}); window.addEventListener("pointercancel",this.onPointerEnd,{passive:true});
      window.addEventListener("resize",this.onResize,{passive:true});
      document.addEventListener("visibilitychange",this.onVisibility);
      this.reducedMotionQuery.addEventListener("change",this.onPreferenceChange);
      this.coarsePointerQuery.addEventListener("change",this.onPreferenceChange);
    }
    onPointerEnd(event) { this.pointers.delete(event.pointerId); }
    onResize() { this.resizeQueued=true; this.wake(); }
    onVisibility() { if (document.hidden) this.stop(); else this.wake(); }
    onPreferenceChange() {
      const wasCoarse=this.coarsePointer;
      this.reducedMotion=this.reducedMotionQuery.matches;
      this.coarsePointer=this.coarsePointerQuery.matches;
      if(wasCoarse!==this.coarsePointer)this.resizeQueued=true;
      if(this.reducedMotion){this.pointers.clear();this.splats.length=0;this.resetState();this.stop();}
      else this.wake();
    }
    onPointer(event) {
      if(this.reducedMotion&&event.type!=="pointerdown") return;
      const now=performance.now(), current={x:event.clientX/Math.max(innerWidth,1),y:1-event.clientY/Math.max(innerHeight,1),time:now}, previous=this.pointers.get(event.pointerId)||current;
      const dx=current.x-previous.x, dy=current.y-previous.y, distance=Math.hypot(dx,dy), speed=Math.min(distance/Math.max(8,now-previous.time)*1000,.13), steps=Math.min(16,Math.max(1,Math.ceil(distance*64)));
      for(let i=1;i<=steps;i++){const t=i/steps;this.splats.push({x:previous.x+dx*t,y:previous.y+dy*t,vx:dx*config.distortionForce*config.motionInfluence*(1+speed*8),vy:dy*config.distortionForce*config.motionInfluence*(1+speed*8),radius:config.distortionRadius*(.78+Math.min(speed*2.4,.28)),strength:config.distortionForce*(.5+Math.min(speed*3.2,.36))});}
      if(this.splats.length>72) this.splats.splice(0,this.splats.length-72); this.pointers.set(event.pointerId,current); this.wake();
    }
    use(program) { const gl=this.gl; gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad); const loc=this.positionLocations.get(program); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0); }
    simulate(dt) {
      const gl=this.gl, read=this.targets[this.readIndex], write=this.targets[1-this.readIndex], u=this.simUniforms, splats=this.splats.splice(0,24), packed=this.packedSplats, velocity=this.packedVelocity;
      splats.forEach((s,i)=>{packed.set([s.x,s.y,s.strength,s.radius],i*4);velocity.set([s.vx,s.vy],i*2);});
      gl.bindFramebuffer(gl.FRAMEBUFFER,write.framebuffer);gl.viewport(0,0,write.width,write.height);this.use(this.simProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,read.texture);
      gl.uniform1i(u.uState,0);gl.uniform2f(u.uTexel,1/read.width,1/read.height);gl.uniform1f(u.uDt,dt);gl.uniform1f(u.uPersistence,config.deformationPersistence);gl.uniform1f(u.uViscosity,config.fluidViscosity);gl.uniform1f(u.uDiffusion,config.fluidDiffusion);gl.uniform1f(u.uRelaxation,config.relaxationSpeed);gl.uniform1i(u.uCount,splats.length);gl.uniform4fv(u.uSplats,packed);gl.uniform2fv(u.uVelocity,velocity);gl.drawArrays(gl.TRIANGLES,0,6);this.readIndex=1-this.readIndex;
    }
    render(now) {
      const gl=this.gl, state=this.targets[this.readIndex], u=this.renderUniforms;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);this.use(this.renderProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,state.texture);
      gl.uniform1i(u.uState,0);gl.uniform2f(u.uResolution,this.canvas.width,this.canvas.height);gl.uniform2f(u.uTexel,1/state.width,1/state.height);gl.uniform3fv(u.uPrimary,this.primary);gl.uniform3fv(u.uSecondary,this.secondary);gl.uniform3fv(u.uAccent,this.accent);gl.uniform1f(u.uTime,(now||performance.now())/1000);gl.uniform1f(u.uAmbientSpeed,this.reducedMotion?0:config.ambientMotionSpeed);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    frame(now) {
      if(!this.running)return;
      const idleFor=now-this.lastInteraction;
      const frameInterval=idleFor<config.activeDuration?config.activeFrameInterval:config.idleFrameInterval;
      const elapsed=now-this.lastTime;
      if(elapsed<frameInterval) { this.queueFrame(frameInterval-elapsed); return; }
      if(this.resizeQueued)this.resize();
      const dt=Math.min((now-this.lastTime)/1000,1/24);
      this.lastTime=now;
      const paletteEase=1-Math.exp(-dt*4.8);
      for(let i=0;i<3;i++){
        this.primary[i]+=(this.targetPrimary[i]-this.primary[i])*paletteEase;
        this.secondary[i]+=(this.targetSecondary[i]-this.secondary[i])*paletteEase;
      }
      const simulationDt=idleFor<config.activeDuration?dt:Math.min(dt*2.2,.1);
      this.simulate(this.reducedMotion?Math.min(simulationDt,1/60):simulationDt);
      this.render(now);
      this.queueFrame(idleFor<config.activeDuration?0:config.idleFrameInterval);
    }
    queueFrame(delay=0){
      if(!this.running||this.destroyed)return;
      if(delay>0){
        this.frameTimer=window.setTimeout(()=>{
          this.frameTimer=0;
          this.raf=requestAnimationFrame(this.frame);
        },delay);
        return;
      }
      this.raf=requestAnimationFrame(this.frame);
    }
    wake(){
      if(!this.gl||document.hidden||this.destroyed)return;
      this.lastInteraction=performance.now();
      if(this.reducedMotion){
        if(this.resizeQueued)this.resize();
        this.primary.set(this.targetPrimary);this.secondary.set(this.targetSecondary);
        this.render(this.lastInteraction);this.stop();return;
      }
      if(this.running&&this.frameTimer){
        window.clearTimeout(this.frameTimer);
        this.frameTimer=0;
        this.raf=requestAnimationFrame(this.frame);
        return;
      }
      this.start();
    }
    start(){if(this.running||!this.gl)return;this.running=true;this.lastTime=performance.now()-config.activeFrameInterval;this.queueFrame();}
    stop(){this.running=false;cancelAnimationFrame(this.raf);window.clearTimeout(this.frameTimer);this.raf=0;this.frameTimer=0;}
    resetState(){
      if(!this.targets||!this.gl)return;
      const gl=this.gl;
      gl.clearColor(0,.5,.5,1);
      this.targets.forEach(target=>{gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);gl.clear(gl.COLOR_BUFFER_BIT);});
      this.readIndex=0;
      this.render(performance.now());
    }
    rgb(hex){const value=parseInt(hex.slice(1),16);return new Float32Array([((value>>16)&255)/255,((value>>8)&255)/255,(value&255)/255]);}
    setPrimaryColor(hex){
      if(!/^#[0-9a-f]{6}$/i.test(hex))return;
      this.targetPrimary.set(this.rgb(hex));
      this.canvas.dataset.fluidPrimary=hex.toUpperCase();
      this.canvas.style.setProperty("--fluid-primary",hex);
      this.wake();
    }
    setSecondaryColor(hex){
      if(!/^#[0-9a-f]{6}$/i.test(hex))return;
      this.targetSecondary.set(this.rgb(hex));
      this.canvas.dataset.fluidSecondary=hex.toUpperCase();
      this.canvas.style.setProperty("--fluid-secondary",hex);
      this.wake();
    }
    setPalette(palette){
      if(!palette||typeof palette!=="object")return;
      this.setPrimaryColor(palette.primary);
      this.setSecondaryColor(palette.secondary);
    }
    deleteTargets(){if(!this.targets||!this.gl)return;this.targets.forEach(t=>{this.gl.deleteTexture(t.texture);this.gl.deleteFramebuffer(t.framebuffer);});this.targets=null;}
    destroyGL(){if(!this.gl)return;this.stop();this.deleteTargets();if(this.quad)this.gl.deleteBuffer(this.quad);if(this.simProgram)this.gl.deleteProgram(this.simProgram);if(this.renderProgram)this.gl.deleteProgram(this.renderProgram);}
    destroy(){
      if(this.destroyed)return;
      this.destroyed=true;
      window.removeEventListener("pointermove",this.onPointer); window.removeEventListener("pointerdown",this.onPointer);
      window.removeEventListener("pointerup",this.onPointerEnd); window.removeEventListener("pointercancel",this.onPointerEnd);
      window.removeEventListener("resize",this.onResize); document.removeEventListener("visibilitychange",this.onVisibility);
      this.reducedMotionQuery.removeEventListener("change",this.onPreferenceChange);
      this.coarsePointerQuery.removeEventListener("change",this.onPreferenceChange);
      this.pointers.clear(); this.splats.length=0; this.destroyGL();
    }
  }

  const canvas=document.querySelector("#fluid-background");
  if(canvas) {
    window.fluidBackground?.destroy?.();
    window.removeEventListener("portfolio:fluid-palette",window.__fluidBackgroundPaletteListener);
    window.removeEventListener("pagehide",window.__fluidBackgroundPageHideListener);
    const fluidBackground = window.fluidBackground = new OrganicFluidBackground(canvas);
    const onPalette = event => fluidBackground.setPalette(event.detail);
    const onPageHide = event => {
      if(event.persisted)return;
      window.removeEventListener("portfolio:fluid-palette",onPalette);
      fluidBackground.destroy();
    };
    window.__fluidBackgroundPaletteListener = onPalette;
    window.__fluidBackgroundPageHideListener = onPageHide;
    window.addEventListener("portfolio:fluid-palette",onPalette);
    window.addEventListener("pagehide",onPageHide);
  }
})();
