import * as T from 'three';
import { SandUnit } from './base-unit.js';

class KnightUnit extends SandUnit {
  constructor(context, role, options) { super(context, role, options); this.makeModel(); }
  makeModel() {
    const mat=this.material, dark=this.dark, captain=this.role==='captain';
    const box=(size,p,m=mat,parent=this.group)=>this.add(new T.BoxGeometry(...size),new T.Vector3(...p),m,parent);
    const oval=(size,p,parent=this.group)=>{const mesh=this.add(new T.SphereGeometry(1,12,8),new T.Vector3(...p),mat,parent);mesh.scale.set(...size);return mesh;};
    const joint=(p,parent=this.group)=>{const g=new T.Group();g.position.set(...p);parent.add(g);return g;};
    oval([.32,.38,.72],[0,.95,0]);
    oval([.35,.4,.32],[0,.96,-.48]); oval([.3,.43,.3],[0,1.05,.44]);
    const neck=box([.32,.73,.34],[0,1.43,.57]); neck.rotation.x=.38;
    this.horseHead=joint([0,1.82,.79]);
    oval([.19,.22,.36],[0,0,.05],this.horseHead);
    box([.27,.19,.38],[0,-.1,.34],mat,this.horseHead);
    for(const side of [-1,1]) {
      const ear=this.add(new T.ConeGeometry(.065,.24,5),new T.Vector3(side*.12,.26,-.08),mat,this.horseHead);ear.rotation.z=-side*.15;
      box([.025,.06,.065],[side*.19,.025,.17],dark,this.horseHead);
      box([.04,.23,.035],[side*.15,-.075,.43],dark,this.horseHead);
    }
    for(let i=0;i<7;i++) box([.13,.15,.12],[0,1.2+i*.085,.32+i*.036],dark);
    this.legs=[];
    for(const side of [-1,1]) for(const z of [-.48,.43]) {
      const leg=joint([side*.24,.88,z]);this.legs.push(leg);
      box([.13,.38,.17],[0,-.18,0],mat,leg);
      const knee=joint([0,-.38,0],leg);knee.rotation.x=z<0?-.18:.12;
      box([.085,.35,.1],[0,-.16,0],mat,knee);box([.16,.13,.24],[0,-.36,.04],dark,knee);
    }
    const tail=box([.14,.63,.18],[0,.71,-.83],dark);tail.rotation.x=-.4;
    box([.65,.09,.7],[0,1.29,-.08],dark);box([.48,.17,.4],[0,1.4,-.08]);
    box([captain?.57:.46,.52,.34],[0,1.82,-.08]);
    for(let i=0;i<3;i++)box([.45-i*.03,.1,.07],[0,1.67+i*.13,.13],dark);
    for(const side of [-1,1]) {
      box([.18,.4,.23],[side*.33,1.25,-.02]);box([.2,.13,.32],[side*.33,1.03,.08],dark);
      box([captain?.3:.23,.17,.38],[side*.3,2.03,-.07]);
    }
    box([.3,.32,.3],[0,2.28,-.07]);box([.26,.045,.025],[0,2.32,.09],dark);
    box([.045,.22,.05],[0,2.23,.1]);
    this.swordArm=joint([.32,1.98,-.03]);
    box([.14,.32,.17],[0,-.15,0],mat,this.swordArm);box([.15,.15,.18],[0,-.3,.04],dark,this.swordArm);
    box([.07,.23,.07],[0,-.27,.21],dark,this.swordArm);
    box([.3,.055,.09],[0,-.13,.21],dark,this.swordArm);
    this.sword=box([captain?.13:.09,this.weaponLength,.045],[0,this.weaponLength/2-.1,.21],mat,this.swordArm);
    const shield=new T.Shape();shield.moveTo(-.26,.28);shield.lineTo(.26,.28);shield.lineTo(.22,-.14);shield.lineTo(0,-.4);shield.lineTo(-.22,-.14);shield.closePath();
    this.add(new T.ExtrudeGeometry(shield,{depth:.07,bevelEnabled:false}),new T.Vector3(-.39,1.73,.2),dark);
    box([.06,.38,.04],[-.39,1.76,.29]);box([.3,.055,.04],[-.39,1.83,.29]);
    if(captain){
      for(let i=0;i<5;i++)box([.1,.22,.1],[0,2.56,-.25+i*.1],dark);
      const cloak=new T.Shape();cloak.moveTo(-.25,0);cloak.lineTo(.25,0);cloak.lineTo(.43,-.85);cloak.lineTo(-.43,-.85);cloak.closePath();
      this.add(new T.ExtrudeGeometry(cloak,{depth:.05,bevelEnabled:false}),new T.Vector3(0,2.03,-.32),dark);
      for(const side of [-1,1])box([.13,.05,.35],[side*.31,2.14,-.06],dark);
    }
    this.parts.forEach(p=>{p.scale.copy(p.mesh.scale);p.rotation.copy(p.mesh.quaternion);this.system.grains.registerPart(this,p);});
  }
}

class CaptainUnit extends KnightUnit { constructor(context, options) { super(context, 'captain', options); } }

export { KnightUnit, CaptainUnit };
