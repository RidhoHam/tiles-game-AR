import * as T from 'three';
import { SandUnit } from './base-unit.js';

class GargoyleUnit extends SandUnit {
  constructor(context, options = {}) { super(context, 'gargoyle', options); this.makeModel(); }
  makeModel() {
    const mat = this.material, dark = this.dark;
    const body=this.add(new T.CylinderGeometry(.3,.18,.6,6),new T.Vector3(0,.75,0),mat);body.rotation.x=.3;
    this.featureParts.head = this.add(new T.BoxGeometry(.36,.3,.34), new T.Vector3(0,1.12,.23), mat);
    this.add(new T.BoxGeometry(.3,.12,.23),new T.Vector3(0,.98,.4),dark);
    for(const side of [-1,1]) {
      const brow=this.add(new T.BoxGeometry(.19,.075,.08),new T.Vector3(side*.1,1.2,.42),dark);brow.rotation.z=side*.2;
      for(let j=0;j<3;j++)this.add(new T.ConeGeometry(.035,.14,5),new T.Vector3(side*(.4+j*.08),.35,.36),dark);
    }
    this.add(new T.ConeGeometry(.1,.3,6), new T.Vector3(-.16,1.38,0), dark, this.group, true);
    this.add(new T.ConeGeometry(.1,.3,6), new T.Vector3(.16,1.38,0), dark, this.group, true);
    this.featureParts.claws = this.add(new T.ConeGeometry(.14,.38,6), new T.Vector3(-.5,.55,.2), dark);
    this.add(new T.ConeGeometry(.14,.38,6), new T.Vector3(.5,.55,.2), dark);
    this.wings = [-1,1].map(side=>{
      const wing=new T.Group();wing.position.set(side*.2,.96,-.12);this.group.add(wing);
      const shape=new T.Shape();shape.moveTo(0,0);shape.lineTo(side*.45,.65);shape.lineTo(side*1.2,.95);shape.lineTo(side*1.06,.24);shape.lineTo(side*.86,.36);shape.lineTo(side*.76,-.12);shape.lineTo(side*.54,.07);shape.lineTo(side*.37,-.27);shape.closePath();
      this.add(new T.ExtrudeGeometry(shape,{depth:.045,bevelEnabled:false}),new T.Vector3(),mat,wing);
      for(const [x,y] of [[.45,.65],[1.2,.95],[.76,-.12]]){
        const end=new T.Vector3(side*x,y,0),rib=this.add(new T.CylinderGeometry(.025,.04,end.length(),6),end.clone().multiplyScalar(.5),dark,wing);
        rib.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.normalize());
      }
      return wing;
    });
    this.featureParts.wingLeft = this.wings[0]; this.featureParts.wingRight = this.wings[1];
    this.add(new T.CylinderGeometry(.09,.14,.42,8), new T.Vector3(-.2,.2,0), mat); this.add(new T.CylinderGeometry(.09,.14,.42,8), new T.Vector3(.2,.2,0), mat);
    const tail=this.add(new T.ConeGeometry(.12,.8,7),new T.Vector3(0,.5,-.5),dark);tail.rotation.x=-1.1;
    this.parts.forEach(p => {p.rotation.copy(p.mesh.quaternion);this.system.grains.registerPart(this, p);});
  }
}

export { GargoyleUnit };
