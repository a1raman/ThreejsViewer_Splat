/*
Copyright © 2010-2024 three.js authors & Mark Kellogg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
*/

import {
    EventDispatcher,
    MOUSE,
    Quaternion,
    Spherical,
    TOUCH,
    Vector2,
    Vector3,
    Plane,
    Ray,
    MathUtils,
    Clock,
    Object3D
} from 'three';
import { SplatBuffer } from './loaders/SplatBuffer';
import { SplatMesh } from './splatmesh/SplatMesh';

// OrbitControls performs orbiting, dollying (zooming), and panning.
// Unlike TrackballControls, it maintains the "up" direction object.up (+Y by default).
//
//    Orbit - left mouse / touch: one-finger move
//    Zoom - middle mouse, or mousewheel / touch: two-finger spread or squish
//    Pan - right mouse, or left mouse + ctrl/meta/shiftKey, or arrow keys / touch: two-finger move

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };
const _ray = new Ray();
const _plane = new Plane();
const TILT_LIMIT = Math.cos( 70 * MathUtils.DEG2RAD );

class OrbitControls extends EventDispatcher {

    constructor( object, domElement, viewer ) {

        super();
        this.object = object;
        this.domElement = domElement;
        this.domElement.style.touchAction = 'none'; // disable touch scroll
        this.viewer = viewer;  // Viewer 인스턴스 저장
        this.graphConnections = null; // graphConnections 초기화
        this.graphPoints = null; // graphPoints 초기화

        // Set to false to disable this control
        this.enabled = true;

        // "target" sets the location of focus, where the object orbits around
        this.target = new Vector3();

        // How far you can dolly in and out ( PerspectiveCamera only )
        this.minDistance = 0;
        this.maxDistance = Infinity;

        // How far you can zoom in and out ( OrthographicCamera only )
        this.minZoom = 0;
        this.maxZoom = Infinity;

        // How far you can orbit vertically, upper and lower limits.
        // Range is 0 to Math.PI radians.
        this.minPolarAngle = 0; // radians
        this.maxPolarAngle = Math.PI; // radians

        // How far you can orbit horizontally, upper and lower limits.
        // If set, the interval [min, max] must be a sub-interval of [- 2 PI, 2 PI], with ( max - min < 2 PI )
        this.minAzimuthAngle = - Infinity; // radians
        this.maxAzimuthAngle = Infinity; // radians

        // Set to true to enable damping (inertia)
        // If damping is enabled, you must call controls.update() in your animation loop
        this.enableDamping = false;
        this.dampingFactor = 0.05;

        // This option actually enables dollying in and out; left as "zoom" for backwards compatibility.
        // Set to false to disable zooming
        this.enableZoom = true;
        this.zoomSpeed = 1.0;

        // Set to false to disable rotating
        this.enableRotate = true;
        this.rotateSpeed = 1.0;

        // Set to false to disable panning
        this.enablePan = true;
        this.panSpeed = 1.0;
        this.screenSpacePanning = true; // if false, pan orthogonal to world-space direction camera.up
        this.keyPanSpeed = 7.0; // pixels moved per arrow key push
        this.zoomToCursor = false;

        // Set to true to automatically rotate around the target
        // If auto-rotate is enabled, you must call controls.update() in your animation loop
        this.autoRotate = false;
        this.autoRotateSpeed = 2.0; // 30 seconds per orbit when fps is 60

        // The four arrow keys
        this.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };

        // Mouse buttons
        this.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

        // Touch fingers
        this.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };

        // for reset
        this.target0 = this.target.clone();
        this.position0 = this.object.position.clone();
        this.zoom0 = this.object.zoom;

        // the target DOM element for key events
        this._domElementKeyEvents = null;

        //
        // public methods
        //
        this.forwardOffset = 1; // Distance to place the target in front of the camera

        // 경계 관련 속성 추가
        this.boundaryPoints = [];
        this.convexHull = [];
        this.enableBoundary = false;

        //경로 관련 속성 추가함
        this.t = 0;
        this.testtest = [];
        this.baseMoveSpeed = 0.5; // 기본 이동 속도
        this.curve = null;
        this.isDataLoaded = false;  // 데이터 로드 상태 플래그
        this.isGraphLoaded = false; // 그래프 로드 플래그
        this.boundaryLoad = false; // 그래프 없을 경우 바운더리 플래그
        this.loadGraphAndPaths()
            .then(() => {
                // 데이터가 로드된 후에 isDataLoaded를 true로 설정
                this.isDataLoaded = true;
                console.log("3")
                //requestAnimationFrame(this.animateHandler.bind(this));
       
            })
            .catch((error) => {
                console.error("Graph and paths loading failed", error);
                this.boundaryLoad = true;
                //requestAnimationFrame(this.animateHandler.bind(this));
            });    
        this.currentPathIndex = 0; // 현재 경로 인덱스
        this.pathProgress = 0; 
        // clock을 클래스의 멤버로 정의
        this.clock = new Clock();
        this.startTime = null; // 애니메이션 시작 시간 초기화
        this.isMoving = false; // 애니메이션 진행 여부
        this.startPosition = new Vector3(); // 시작 위치
        this.targetPosition = new Vector3(); // 목표 위치

        this.graph = new Map(); // 그래프 구조를 저장할 Map
        this.currentNode = null; // 현재 위치한 노드
        this.targetNode = null; // 목표 노드
        this.movementSpeed = 0.1;
        this.rotationSpeed = 0.05;
        this.graphPoints = [];

        //
        // internals
        //

        const scope = this;

        this.STATE = {
            NONE: - 1,
            ROTATE: 0,
            DOLLY: 1,
            PAN: 2,
            TOUCH_ROTATE: 3,
            TOUCH_PAN: 4,
            TOUCH_DOLLY_PAN: 5,
            TOUCH_DOLLY_ROTATE: 6
        };

        this.state = this.STATE.NONE;

        this.EPS = 0.000001;

        // current position in spherical coordinates
        this.spherical = new Spherical();
        this.sphericalDelta = new Spherical();

        this.scale = 1;
        this.panOffset = new Vector3();

        this.rotateStart = new Vector2();
        this.rotateEnd = new Vector2();
        this.rotateDelta = new Vector2();

        this.panStart = new Vector2();
        this.panEnd = new Vector2();
        this.panDelta = new Vector2();

        this.dollyStart = new Vector2();
        this.dollyEnd = new Vector2();
        this.dollyDelta = new Vector2();

        this.dollyDirection = new Vector3();
        this.mouse = new Vector2();
        this.performCursorZoom = false;

        this.pointers = [];
        this.pointerPositions = {};
        this.screenSpacePanning = true; // 필요에 따라 설정
        this.panOffset = new Vector3(); // panOffset을 클래스 속성으로 추가

        //0829
        this.keysPressed = {
            UP: false,
            DOWN: false,
            LEFT: false,
            RIGHT: false
        }
        // keydown, keyup 이벤트 리스너
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);

        // 애니메이션
        //this.animate = this.animate.bind(this);
        
        // this.loadGraphAndPaths().then(() => {
        //     this.animate();
        // }).catch((error) => {
        //     console.error("Graph and paths loading failed", error);
        // });

        this.addEventListeners();
 
        // force an update at start
        //this.update();
    
    }

    getPolarAngle() {

        return this.spherical.phi;

    }
    getAzimuthalAngle() {

        return this.spherical.theta;

    }

    getDistance() {

        return this.object.position.distanceTo( this.target );

    }
    animateHandler(event) {
        // if (this.animationStarted){ 
        //     console.log(this.isGraphLoaded, this.isDataLoaded);
        //     return; // 애니메이션 이미 시작된 경우 중복 실행 방지
        // }
        if (this.isGraphLoaded && this.isDataLoaded && !this.animationStarted2) {
            this.animate();
            //console.log("들어왔다!!")
            this.animationStarted = true; // 애니메이션 시작 상태 플래그 설정
        } else if(!this.animationStarted){
            this.animate2();
            //console.log("개망함!!", this.animationStarted2)
            this.animationStarted2 = true; // 애니메이션 시작 상태 플래그 설정

        }
    }
    listenToKeyEvents( domElement ) {

         // keydown, keyup 이벤트 처리 함수 바인딩
        domElement.addEventListener('keydown', this.handleKeyDown.bind(this));
        domElement.addEventListener('keyup', this.handleKeyUp.bind(this));
        domElement.addEventListener('keydown', this.animateHandler.bind(this));

        // this._domElementKeyEvents = domElement;

    }

    stopListenToKeyEvents() {

        this._domElementKeyEvents.removeEventListener( 'keydown', onKeyDown );
        this._domElementKeyEvents = null;

    }

    saveState() {

        this.target0.copy( this.target );
        this.position0.copy( this.object.position );
        this.zoom0 = this.object.zoom;

    }

    reset() {

        this.target.copy( this.target0 );
        this.object.position.copy( this.position0 );
        this.object.zoom = this.zoom0;
        this.clearDampedRotation();
        this.clearDampedPan();

        this.object.updateProjectionMatrix();
        this.dispatchEvent( _changeEvent );

        this.update();

        state = this.STATE.NONE;

    }

    clearDampedRotation() {
        this.sphericalDelta.theta = 0.0;
        this.sphericalDelta.phi = 0.0;
    }

    clearDampedPan() {
        this.panOffset.set(0, 0, 0);
    }

    // this method is exposed, but perhaps it would be better if we can make it private...
    update() {

        const offset = new Vector3();
    
        // so camera.up is the orbit axis
        const quat = new Quaternion().setFromUnitVectors(this.object.up, new Vector3(0, 1, 0));
        const quatInverse = quat.clone().invert();
    
        const lastPosition = new Vector3();
        const lastQuaternion = new Quaternion();
        const lastTargetPosition = new Vector3();
    
        const twoPI = 2 * Math.PI;

        const executeUpdate = () => {
    
            quat.setFromUnitVectors(this.object.up, new Vector3(0, 1, 0));
            quatInverse.copy(quat).invert();
    
            const position = this.object.position;
    
            const forwardDirection = new Vector3(0, 0, -0.0000001).applyQuaternion(this.object.quaternion);
        
            // Set the target to be slightly in front of the camera
            this.target.copy(position).addScaledVector(forwardDirection, this.forwardOffset);
    
            offset.copy(position).sub(this.target);
    
            // rotate offset to "y-axis-is-up" space
            offset.applyQuaternion(quat);
    
            // angle from z-axis around y-axis
            this.spherical.setFromVector3(offset);
    
            if (this.autoRotate && this.state === this.STATE.NONE) {
                this.rotateLeft(this.getAutoRotationAngle());
            }

            if (this.enableDamping) {
                this.spherical.theta += this.sphericalDelta.theta * this.dampingFactor;
                this.spherical.phi += this.sphericalDelta.phi * this.dampingFactor;
            } else {
                this.spherical.theta += this.sphericalDelta.theta;
                this.spherical.phi += this.sphericalDelta.phi;
            }
    
            // restrict theta to be between desired limits
            let min = this.minAzimuthAngle;
            let max = this.maxAzimuthAngle;
    
            if (isFinite(min) && isFinite(max)) {
                if (min < -Math.PI) min += twoPI; else if (min > Math.PI) min -= twoPI;
                if (max < -Math.PI) max += twoPI; else if (max > Math.PI) max -= twoPI;
    
                if (min <= max) {
                    this.spherical.theta = Math.max(min, Math.min(max, this.spherical.theta));
                } else {
                    this.spherical.theta = (this.spherical.theta > (min + max) / 2) ?
                        Math.max(min, this.spherical.theta) :
                        Math.min(max, this.spherical.theta);
                }
            }
    
            this.spherical.theta = Math.max(this.minAzimuthAngle, Math.min(this.maxAzimuthAngle, this.spherical.theta));
            this.spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.spherical.phi));
    
            this.spherical.makeSafe();
    
            // move target to panned location
            if (this.enableDamping === true) {
                this.target.addScaledVector(this.panOffset, this.dampingFactor);
            } else {
                this.target.add(this.panOffset);
            }
    
            // adjust the camera position based on zoom only if we're not zooming to the cursor or if it's an ortho camera
            if (this.zoomToCursor && this.performCursorZoom || this.object.isOrthographicCamera) {
                this.spherical.radius = this.clampDistance(this.spherical.radius);
            } else {
                this.spherical.radius = this.clampDistance(this.spherical.radius * this.scale);
            }
    
            offset.setFromSpherical(this.spherical);
    
            // rotate offset back to "camera-up-vector-is-up" space
            offset.applyQuaternion(quatInverse);
    
            position.copy(this.target).add(offset);
    
            this.object.lookAt(this.target);
    
            if (this.enableDamping === true) {
                this.sphericalDelta.theta *= (1 - this.dampingFactor);
                this.sphericalDelta.phi *= (1 - this.dampingFactor);
                this.panOffset.multiplyScalar(1 - this.dampingFactor);
            } else {
                this.sphericalDelta.set(0, 0, 0);
                this.panOffset.set(0, 0, 0);
            }
    
            // adjust camera position
            let zoomChanged = false;
            if (this.zoomToCursor && this.performCursorZoom) {
                let newRadius = null;
                if (this.object.isPerspectiveCamera) {
                    // move the camera down the pointer ray
                    const prevRadius = offset.length();
                    newRadius = this.clampDistance(prevRadius * scale);
                    const radiusDelta = prevRadius - newRadius;
                    this.object.position.addScaledVector(this.dollyDirection, radiusDelta);
                    this.object.updateMatrixWorld();
                } else if (this.object.isOrthographicCamera) {
                    const mouseBefore = new Vector3(this.mouse.x, this.mouse.y, 0);
                    mouseBefore.unproject(this.object);
    
                    this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / scale));
                    this.object.updateProjectionMatrix();
                    zoomChanged = true;
    
                    const mouseAfter = new Vector3(this.mouse.x, this.mouse.y, 0);
                    mouseAfter.unproject(this.object);
    
                    this.object.position.sub(mouseAfter).add(mouseBefore);
                    this.object.updateMatrixWorld();
    
                    newRadius = offset.length();
                } else {
                    console.warn('WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.');
                    this.zoomToCursor = false;
                }
    
                // handle the placement of the target
                if (newRadius !== null) {
                    if (this.screenSpacePanning) {
                        this.target.set(0, 0, -1)
                            .transformDirection(this.object.matrix)
                            .multiplyScalar(newRadius)
                            .add(this.object.position);
                    } else {
                        _ray.origin.copy(this.object.position);
                        _ray.direction.set(0, 0, -1).transformDirection(this.object.matrix);
    
                        if (Math.abs(this.object.up.dot(_ray.direction)) < TILT_LIMIT) {
                            this.object.lookAt(this.target);
                        } else {
                            _plane.setFromNormalAndCoplanarPoint(this.object.up, this.target);
                            _ray.intersectPlane(_plane, this.target);
                        }
                    }
                }
    
            } else if (this.object.isOrthographicCamera) {
                this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / this.scale));
                this.object.updateProjectionMatrix();
                zoomChanged = true;
            }
    
            this.erformCursorZoom = false;
    
            if (zoomChanged ||
                lastPosition.distanceToSquared(this.object.position) > this.EPS ||
                8 * (1 - lastQuaternion.dot(this.object.quaternion)) > this.EPS) {
                this.dispatchEvent(_changeEvent);
    
                lastPosition.copy(this.object.position);
                lastQuaternion.copy(this.object.quaternion);
                lastTargetPosition.copy(this.target);
    
                zoomChanged = false;
    
                return true;
            }
    
            return false;
        };
        executeUpdate();
        return executeUpdate;
    }

    dispose() {
        this.domElement.removeEventListener( 'contextmenu', this.onContextMenu );
        this.domElement.removeEventListener( 'pointerdown', this.onPointerDown );
        this.domElement.removeEventListener( 'pointercancel', this.onPointerUp );
        this.domElement.removeEventListener( 'wheel', this.onMouseWheel );
        this.domElement.removeEventListener( 'pointermove', this.onPointerMove );
        this.domElement.removeEventListener( 'pointerup', this.onPointerUp );

        if ( this._domElementKeyEvents !== null ) {
            this._domElementKeyEvents.removeEventListener( 'keydown', this.onKeyDown );
            this._domElementKeyEvents = null;
        }
    }
    getAutoRotationAngle() {

        return 2 * Math.PI / 60 / 60 * this.autoRotateSpeed;

    }

    getZoomScale() {

        return Math.pow( 0.95, this.zoomSpeed );

    }

    rotateLeft( angle ) {

        this.sphericalDelta.theta -= angle;

    }
    rotateRight( angle ) {

        this.sphericalDelta.theta = angle;

    }
    rotateUp( angle ) {

        this.sphericalDelta.phi -= angle;

    }

    panLeft(distance, objectMatrix) {
        const v = new Vector3();
        v.setFromMatrixColumn(objectMatrix, 0); // objectMatrix의 X 열 가져오기
        v.multiplyScalar(-distance);
        
        this.panOffset.add(v);
    }

    panUp(distance, objectMatrix) {
        const v = new Vector3();

        if (this.screenSpacePanning === true) {
            v.setFromMatrixColumn(objectMatrix, 1);
        } else {
            v.setFromMatrixColumn(objectMatrix, 0);
            v.crossVectors(this.object.up, v);
        }

        v.multiplyScalar(distance);
        this.panOffset.add(v);
    }

    pan(deltaX, deltaY) {
        const offset = new Vector3();
        const element = this.domElement;

        if (this.object.isPerspectiveCamera) {
            // perspective camera
            const position = this.object.position;
            offset.copy(position).sub(this.target);
            let targetDistance = offset.length();

            // half of the fov is center to top of screen
            targetDistance *= Math.tan((this.object.fov / 2) * Math.PI / 180.0);

            // Use only clientHeight to avoid aspect ratio distortion
            this.panLeft(2 * deltaX * targetDistance / element.clientHeight, this.object.matrix);
            this.panUp(2 * deltaY * targetDistance / element.clientHeight, this.object.matrix);

        } else if (this.object.isOrthographicCamera) {
            // orthographic camera
            this.panLeft(deltaX * (this.object.right - this.object.left) / this.object.zoom / element.clientWidth, this.object.matrix);
            this.panUp(deltaY * (this.object.top - this.object.bottom) / this.object.zoom / element.clientHeight, this.object.matrix);

        } else {
            // unknown camera type
            console.warn('WARNING: OrbitControls encountered an unknown camera type - pan disabled.');
            this.enablePan = false;
        }
    }
    //Move 0829  
    
    moveOut() {
        const movementDirection = new Vector3();
        this.object.getWorldDirection(movementDirection);
        movementDirection.z = 0; // z 구성 요소를 0으로 설정
        movementDirection.normalize(); // 벡터를 정규화
        const newPosition = this.object.position.clone().addScaledVector(movementDirection, -0.01); // 새로운 위치 계산
        // 경계 확인
        if (!this.isInsideBoundary(newPosition)) {
            console.log("Boundary reached. Movement blocked.");
            return; // 경계를 벗어나면 이동하지 않음
        }
    
        // 경계 내에 있을 경우 이동 처리
        this.object.position.addScaledVector(movementDirection, -0.01);
    }

    moveIn() {
        const movementDirection = new Vector3();
        this.object.getWorldDirection(movementDirection);
        movementDirection.z = 0;
        movementDirection.normalize();
    
        const newPosition = this.object.position.clone().addScaledVector(movementDirection, 0.01); // 새로운 위치 계산
    
        // 경계 확인
        if (!this.isInsideBoundary(newPosition)) {
            console.log("Boundary reached. Movement blocked.");
            return; // 경계를 벗어나면 이동하지 않음
        }
    
        // 경계 내에 있을 경우 이동 처리
        this.object.position.addScaledVector(movementDirection, 0.01);
    }
    
    moveLeft(scale = 1) {
        const movementDirection = new Vector3();
        this.object.getWorldDirection(movementDirection);
        movementDirection.z = 0;
        movementDirection.normalize();
    
        // 왼쪽 방향 벡터 계산
        const leftVector = new Vector3();
        leftVector.crossVectors(movementDirection, this.object.up).normalize();
        const newPosition = this.object.position.clone().addScaledVector(leftVector, -0.01 * scale); // 새로운 위치 계산
    
        // 경계 확인
        if (!this.isInsideBoundary(newPosition)) {
            console.log("Boundary reached. Movement blocked.");
            return; // 경계를 벗어나면 이동하지 않음
        }
    
        // 경계 내에 있을 경우 이동 처리
        this.object.position.addScaledVector(leftVector, -0.01 * scale);
    }
    
    moveRight(scale = 1) {
        const movementDirection = new Vector3();
        this.object.getWorldDirection(movementDirection);
        movementDirection.z = 0;
        movementDirection.normalize();
    
        // 오른쪽 방향 벡터 계산
        const rightVector = new Vector3();
        rightVector.crossVectors(movementDirection, this.object.up).normalize();
        const newPosition = this.object.position.clone().addScaledVector(rightVector, 0.01 * scale); // 새로운 위치 계산
    
        // 경계 확인
        if (!this.isInsideBoundary(newPosition)) {
            console.log("Boundary reached. Movement blocked.");
            return; // 경계를 벗어나면 이동하지 않음
        }
    
        // 경계 내에 있을 경우 이동 처리
        this.object.position.addScaledVector(rightVector, 0.01 * scale);
    }

    
    dollyOut(dollyScale) {
        if (this.object.isPerspectiveCamera || this.object.isOrthographicCamera) {
            this.scale /= dollyScale;
        } else {
            console.warn('WARNING: OrbitControls encountered an unknown camera type - dolly/zoom disabled.');
            this.enableZoom = false;
        }
    }

    dollyIn(dollyScale) {
        if (this.object.isPerspectiveCamera || this.object.isOrthographicCamera) {
            this.scale *= dollyScale;
        } else {
            console.warn('WARNING: OrbitControls encountered an unknown camera type - dolly/zoom disabled.');
            this.enableZoom = false;
        }
    }

    updateMouseParameters(event) {
        if (!this.zoomToCursor) {
            return;
        }
        this.performCursorZoom = true;

        const rect = this.domElement.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;

        this.mouse.x = (x / w) * 2 - 1;
        this.mouse.y = -(y / h) * 2 + 1;

        this.dollyDirection.set(this.mouse.x, this.mouse.y, 1).unproject(this.object).sub(this.object.position).normalize();
    }

    clampDistance(dist) {
        return Math.max(this.minDistance, Math.min(this.maxDistance, dist));
    }

    handleMouseDownRotate(event) {
        this.rotateStart.set(event.clientX, event.clientY);
    }

    handleMouseDownDolly(event) {
        this.updateMouseParameters(event);
        this.dollyStart.set(event.clientX, event.clientY);
    }

    handleMouseDownPan(event) {
        this.panStart.set(event.clientX, event.clientY);
    }

    handleMouseMoveRotate(event) {
        this.rotateEnd.set(event.clientX, event.clientY);
        this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart).multiplyScalar(this.rotateSpeed);
        const element = this.domElement;

        this.rotateLeft(2 * Math.PI * this.rotateDelta.x / element.clientHeight); // yes, height
        this.rotateUp(2 * Math.PI * this.rotateDelta.y / element.clientHeight);

        this.rotateStart.copy(this.rotateEnd);
        this.update();
    }

    handleMouseMoveDolly(event) {
        this.dollyEnd.set(event.clientX, event.clientY);
        this.dollyDelta.subVectors(this.dollyEnd, this.dollyStart);

        if (this.dollyDelta.y > 0) {
            this.dollyOut(this.getZoomScale());
        } else if (this.dollyDelta.y < 0) {
            this.dollyIn(this.getZoomScale());
        }

        this.dollyStart.copy(this.dollyEnd);
        this.update();
    }

    handleMouseMovePan(event) {
        this.panEnd.set(event.clientX, event.clientY);
        this.panDelta.subVectors(this.panEnd, this.panStart).multiplyScalar(this.panSpeed);

        this.pan(this.panDelta.x, this.panDelta.y);
        this.panStart.copy(this.panEnd);
        this.update();
    }

    handleMouseWheel(event) {
        this.updateMouseParameters(event);

        if (event.deltaY < 0) {
            this.dollyIn(this.getZoomScale());
        } else if (event.deltaY > 0) {
            this.dollyOut(this.getZoomScale());
        }

        this.update();
    }
    handleKeyDown(event) {
        switch (event.code) {
            case this.keys.UP:
                this.keysPressed.UP = true;
                break;
            case this.keys.BOTTOM:
                this.keysPressed.DOWN = true;
                break;
            case this.keys.LEFT:
                this.keysPressed.LEFT = true;
                break;
            case this.keys.RIGHT:
                this.keysPressed.RIGHT = true;
                break;
        }
        event.preventDefault();
    }
    
    handleKeyUp(event) {
        switch (event.code) {
            case this.keys.UP:
                this.keysPressed.UP = false;
                break;
            case this.keys.BOTTOM:
                this.keysPressed.DOWN = false;
                break;
            case this.keys.LEFT:
                this.keysPressed.LEFT = false;
                break;
            case this.keys.RIGHT:
                this.keysPressed.RIGHT = false;
                break;
        }
        event.preventDefault();
    }

    getForwardDirection() {
        const direction = new Vector3();
        if (this.object && this.object instanceof Object3D) {
            this.object.getWorldDirection(direction);
            direction.z = 0; // z 값을 유지
            direction.normalize();
            return direction;
        } else {
            console.error('Object is not defined or is not an instance of THREE.Object3D');
            return new Vector3();
        }
    }

    getBackwardDirection() {
        return this.getForwardDirection().negate();
    }

    getRightDirection() {
        const direction = new Vector3();
        if (this.object && this.object instanceof Object3D) {
            this.object.getWorldDirection(direction);
            const rightDirection = new Vector3().crossVectors(direction, this.object.up);
            rightDirection.z = 0;
            rightDirection.normalize();
            return rightDirection;
        } else {
            console.error('Object is not defined or is not an instance of THREE.Object3D');
            return new Vector3();
        }
    }

    getLeftDirection() {
        return this.getRightDirection().negate();
    }

    updateCameraMovementNoneData(deltaTime){
        const moveSpeed = this.baseMoveSpeed * deltaTime;
        let movement = new Vector3();

        if (this.keysPressed.UP) {
            //console.log("roads가 false다")
            movement = this.getForwardDirection().multiplyScalar(moveSpeed);
        }
        if (this.keysPressed.DOWN) {
            movement = this.getBackwardDirection().multiplyScalar(moveSpeed);
        }
        if (this.keysPressed.LEFT) {
            movement = this.getLeftDirection().multiplyScalar(moveSpeed);
        }
        if (this.keysPressed.RIGHT) {
            movement = this.getRightDirection().multiplyScalar(moveSpeed);
        }
        // 이동 후의 예상 위치 계산
        const newPosition = this.object.position.clone().add(movement).setZ(0); // 2D 좌표화
        // 경계 확인
        if (!this.isInsideBoundary(newPosition)) {
            //console.log("Boundary reached. Movement blocked.");
            return; // 경계를 벗어나면 이동하지 않음
        }
        this.object.position.add(movement);
    }
    updateCameraMovement(deltaTime) {
        const moveSpeed = this.baseMoveSpeed * deltaTime;
        let movement = new Vector3();

        if (this.keysPressed.UP) {
            //console.log("roads가 true다")

            movement = this.getForwardDirection().multiplyScalar(moveSpeed);
        }
        if (this.keysPressed.DOWN) {
            movement = this.getBackwardDirection().multiplyScalar(moveSpeed);
        }
        if (this.keysPressed.LEFT) {
            movement = this.getLeftDirection().multiplyScalar(moveSpeed);
        }
        if (this.keysPressed.RIGHT) {
            movement = this.getRightDirection().multiplyScalar(moveSpeed);
        }

        const newPosition = this.object.position.clone().add(movement);
        let isWithinRoad = false;
        const roadWidth = 0.2;

        for (const road of this.roads) {
            if (this.isPointInsideRoad(newPosition, road, roadWidth)) {
                isWithinRoad = true;

                break;
            }
        }

        if (isWithinRoad) {
            this.object.position.copy(newPosition);
        }
    }

    isPointInsideRoad(point, road, roadWidth) {
        const toPoint = new Vector3().subVectors(point, road.centerStart);
        const toEnd = new Vector3().subVectors(road.centerEnd, road.centerStart);

        const projection = toPoint.dot(toEnd) / toEnd.lengthSq();
        if (projection < 0 || projection > 1) {
            return false;
        }
        const closestPoint = new Vector3().copy(road.centerStart).add(toEnd.multiplyScalar(projection));

        const distance = closestPoint.distanceTo(point);

        return distance <= roadWidth / 2;
    }

    animate() {
        if (this.clock) {
            const deltaTime = this.clock.getDelta();      
            //this.updateCameraMovement(deltaTime);      
            //console.log("isDataLoaded:", this.isDataLoaded, "roads:", this.roads ? this.roads.length : "undefined");
            console.log("4_yes")

            if (this.isDataLoaded && this.roads && this.roads.length > 0) {
                this.updateCameraMovement(deltaTime);
            }
            if (this.isMoving) {
                const elapsed = (performance.now() - this.startTime) / 1000;
                const duration = 1.5;
                const t = Math.min(elapsed / duration, 1);
    
                this.object.position.lerpVectors(this.startPosition, this.targetPosition, t);
    
                if (t >= 1) {
                    this.isMoving = false;
                }
            }
        }
        requestAnimationFrame(this.animateHandler.bind(this));
    }
    animate2() {
        if(this.isGraphLoaded){
            console.log("------------------------------------------graph loaded")
            return;
        }
        if (this.clock) {
            const deltaTime = this.clock.getDelta();      
            //this.updateCameraMovement(deltaTime);      
            //console.log("isDataLoaded:", this.isDataLoaded, "roads:", this.roads ? this.roads.length : "undefined");


            //console.log("4_no")
            if (!this.isDataLoaded && !this.roads) {
                this.updateCameraMovementNoneData(deltaTime);
            }

            if (this.isMoving) {
                const elapsed = (performance.now() - this.startTime) / 1000;
                const duration = 1.5;
                const t = Math.min(elapsed / duration, 1);
    
                this.object.position.lerpVectors(this.startPosition, this.targetPosition, t);
    
                if (t >= 1) {
                    this.isMoving = false;
                }
            }
        }
        requestAnimationFrame(this.animateHandler.bind(this));
    }
    handleTouchStartRotate() {
        if (this.pointers.length === 1) {
            this.rotateStart.set(this.pointers[0].pageX, this.pointers[0].pageY);
        } else {
            const x = 0.5 * (this.pointers[0].pageX + this.pointers[1].pageX);
            const y = 0.5 * (this.pointers[0].pageY + this.pointers[1].pageY);
            this.rotateStart.set(x, y);
        }
    }
    handleTouchStartPan() {
        if (this.pointers.length === 1) {
            this.panStart.set(this.pointers[0].pageX, this.pointers[0].pageY);
        } else {
            const x = 0.5 * (this.pointers[0].pageX + this.pointers[1].pageX);
            const y = 0.5 * (this.pointers[0].pageY + this.pointers[1].pageY);
            this.panStart.set(x, y);
        }
    }

    handleTouchStartDolly() {
        const dx = this.pointers[0].pageX - this.pointers[1].pageX;
        const dy = this.pointers[0].pageY - this.pointers[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        this.dollyStart.set(0, distance);
    }

    handleTouchStartDollyPan() {
        if (this.enableZoom) this.handleTouchStartDolly();
        if (this.enablePan) this.handleTouchStartPan();
    }

    handleTouchStartDollyRotate() {
        if (this.enableZoom) this.handleTouchStartDolly();
        if (this.enableRotate) this.handleTouchStartRotate();
    }

    handleTouchMoveRotate(event) {
        if (this.pointers.length == 1) {
            this.rotateEnd.set(event.pageX, event.pageY);
        }

        this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart).multiplyScalar(this.rotateSpeed);
        const element = this.domElement;

        this.rotateLeft(-1 * Math.PI * this.rotateDelta.x / element.clientHeight); // 반대로 바꿈
        this.rotateUp(-1 * Math.PI * this.rotateDelta.y / element.clientHeight);

        this.rotateStart.copy(this.rotateEnd);
    }

    handleTouchMovePan(event) {
        if (this.pointers.length === 1) {
            this.panEnd.set(event.pageX, event.pageY);
        } else {
            const position = this.getSecondPointerPosition(event);
            const x = 0.5 * (event.pageX + position.x);
            const y = 0.5 * (event.pageY + position.y);
            this.panEnd.set(x, y);
        }

        // 좌우 이동 감지
        this.panDelta.subVectors(this.panEnd, this.panStart).multiplyScalar(this.panSpeed);

        if (this.panDelta.x < 0) {
            this.moveRight(0.3); // 오른쪽으로 이동 시 moveRight 호출
        } else if (this.panDelta.x > 0) {
            this.moveLeft(0.3); // 왼쪽으로 이동 시 moveLeft 호출
        }

        this.panStart.copy(this.panEnd);
    }

    handleTouchMoveDolly(event) {
        const position = this.getSecondPointerPosition(event);
        const dx = event.pageX - position.x;
        const dy = event.pageY - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        this.dollyEnd.set(0, distance);

        this.dollyDelta.set(0, Math.pow(this.dollyEnd.y / this.dollyStart.y, this.zoomSpeed));

        if (this.dollyDelta.y < 1) {
            this.moveOut(this.dollyDelta.y);  // 줌을 줄일 때 moveOut 함수 호출
        } else if (this.dollyDelta.y > 1) {
            this.moveIn(this.dollyDelta.y);   // 줌을 할 때 moveIn 함수 호출
        }

        this.dollyStart.copy(this.dollyEnd);
    }

    handleTouchMoveDollyPan( event ) {

        if ( this.enableZoom ) this.handleTouchMoveDolly( event );

        if ( this.enablePan ) this.handleTouchMovePan( event );

    }

    handleTouchMoveDollyRotate( event ) {

        if ( scope.enableZoom ) this.handleTouchMoveDolly( event );

        if ( scope.enableRotate ) this.handleTouchMoveRotate( event );

    }
    // Event handlers
    onPointerDown( event ) {
        if ( this.enabled === false ) return;
        if ( this.pointers.length === 0 ) {
            this.domElement.setPointerCapture( event.pointerId );
            this.domElement.addEventListener( 'pointermove', this.onPointerMove.bind(this) );
            this.domElement.addEventListener( 'pointerup', this.onPointerUp.bind(this) );
        }
        this.addPointer( event );
        if ( event.pointerType === 'touch' ) {
            this.onTouchStart( event );
        } else {
            this.onMouseDown( event );
        }
    }

    onPointerMove( event ) {
        if ( this.enabled === false ) return;
        if ( event.pointerType === 'touch' ) {
            this.onTouchMove( event );
        } else {
            this.onMouseMove( event );
        }
    }

    onPointerUp( event ) {
        this.removePointer( event );
        if ( this.pointers.length === 0 ) {
            this.domElement.releasePointerCapture( event.pointerId );
            this.domElement.removeEventListener( 'pointermove', this.onPointerMove.bind(this) );
            this.domElement.removeEventListener( 'pointerup', this.onPointerUp.bind(this) );
        }
        this.dispatchEvent( _endEvent );
        this.state = this.STATE.NONE;
    }

    onMouseDown( event ) {
        let mouseAction;
        switch ( event.button ) {
            case 0: mouseAction = this.mouseButtons.LEFT;   break;
            case 1: mouseAction = this.mouseButtons.MIDDLE; break;
            case 2: mouseAction = this.mouseButtons.RIGHT;
                if(this.originCursor) {
                    console.log("pick", this.originCursor);
                    this.moveCameraToClosestGraphPoint();
                }
                break;
            default: mouseAction = -1;
        }
        switch ( mouseAction ) {
            case MOUSE.DOLLY:
                if ( this.enableZoom === false ) return;
                this.handleMouseDownDolly( event );
                this.state = this.STATE.DOLLY;
                break;
            case MOUSE.ROTATE:
                if ( event.ctrlKey || event.metaKey || event.shiftKey ) {
                    if ( this.enablePan === false ) return;
                    this.handleMouseDownPan( event );
                    this.state = this.STATE.PAN;
                } else {
                    if ( this.enableRotate === false ) return;
                    this.handleMouseDownRotate( event );
                    this.state = this.STATE.ROTATE;
                }
                break;
            case MOUSE.PAN:
                if ( event.ctrlKey || event.metaKey || event.shiftKey ) {
                    if ( this.enableRotate === false ) return;
                    this.handleMouseDownRotate( event );
                    this.state = this.STATE.ROTATE;
                } else {
                    if ( this.enablePan === false ) return;
                    this.handleMouseDownPan( event );
                    this.state = this.STATE.PAN;
                }
                break;
            default:
                this.state = this.STATE.NONE;
        }
        if ( this.state !== this.STATE.NONE ) {
            this.dispatchEvent( _startEvent );
        }
    }

    onMouseMove( event ) {
        switch ( this.state ) {
            case this.STATE.ROTATE:
                if ( this.enableRotate === false ) return;
                this.handleMouseMoveRotate( event );
                break;
            case this.STATE.DOLLY:
                if ( this.enableZoom === false ) return;
                this.handleMouseMoveDolly( event );
                break;
            case this.STATE.PAN:
                if ( this.enablePan === false ) return;
                this.handleMouseMovePan( event );
                break;
        }
    }

    onMouseWheel( event ) {
        if ( this.enabled === false || this.enableZoom === false || this.state !== this.STATE.NONE ) return;
        event.preventDefault();
        this.dispatchEvent( _startEvent );
        this.handleMouseWheel( event );
        this.dispatchEvent( _endEvent );
    }

    onKeyDown( event ) {
        if ( this.enabled === false || this.enablePan === false ) return;
        this.handleKeyDown( event );
    }

    onTouchStart( event ) {
        this.trackPointer( event );
        switch ( this.pointers.length ) {
            case 1:
                switch ( this.touches.ONE ) {
                    case TOUCH.ROTATE:
                        if ( this.enableRotate === false ) return;
                        this.handleTouchStartRotate();
                        this.state = this.STATE.TOUCH_ROTATE;
                        break;
                    case TOUCH.PAN:
                        if ( this.enablePan === false ) return;
                        this.handleTouchStartPan();
                        this.state = this.STATE.TOUCH_PAN;
                        break;
                    default:
                        this.state = this.STATE.NONE;
                }
                break;
            case 2:
                switch ( this.touches.TWO ) {
                    case TOUCH.DOLLY_PAN:
                        if ( this.enableZoom === false && this.enablePan === false ) return;
                        this.handleTouchStartDollyPan();
                        this.state = this.STATE.TOUCH_DOLLY_PAN;
                        break;
                    case TOUCH.DOLLY_ROTATE:
                        if ( this.enableZoom === false && this.enableRotate === false ) return;
                        this.handleTouchStartDollyRotate();
                        this.state = this.STATE.TOUCH_DOLLY_ROTATE;
                        break;
                    default:
                        this.state = this.STATE.NONE;
                }
                break;
            default:
                this.state = this.STATE.NONE;
        }
        if ( this.state !== this.STATE.NONE ) {
            this.dispatchEvent( _startEvent );
        }
    }

    onTouchMove( event ) {
        this.trackPointer( event );
        switch ( this.state ) {
            case this.STATE.TOUCH_ROTATE:
                if ( this.enableRotate === false ) return;
                this.handleTouchMoveRotate( event );
                this.update();
                break;
            case this.STATE.TOUCH_PAN:
                if ( this.enablePan === false ) return;
                this.handleTouchMovePan( event );
                this.update();
                break;
            case this.STATE.TOUCH_DOLLY_PAN:
                if ( this.enableZoom === false && this.enablePan === false ) return;
                this.handleTouchMoveDollyPan( event );
                this.update();
                break;
            case this.STATE.TOUCH_DOLLY_ROTATE:
                if ( this.enableZoom === false && this.enableRotate === false ) return;
                this.handleTouchMoveDollyRotate( event );
                this.update();
                break;
            default:
                this.state = this.STATE.NONE;
        }
    }

    onContextMenu( event ) {
        if ( this.enabled === false ) return;
        event.preventDefault();
    }

    addPointer( event ) {
        this.pointers.push( event );
    }

    removePointer( event ) {
        delete this.pointerPositions[event.pointerId];
        for ( let i = 0; i < this.pointers.length; i ++ ) {
            if ( this.pointers[i].pointerId == event.pointerId ) {
                this.pointers.splice( i, 1 );
                return;
            }
        }
    }

    trackPointer( event ) {
        let position = this.pointerPositions[event.pointerId];
        if ( position === undefined ) {
            position = new Vector2();
            this.pointerPositions[event.pointerId] = position;
        }
        position.set( event.pageX, event.pageY );
    }

    getSecondPointerPosition( event ) {
        const pointer = ( event.pointerId === this.pointers[0].pointerId ) ? this.pointers[1] : this.pointers[0];
        return this.pointerPositions[pointer.pointerId];
    }
    
    // Add event listeners
    addEventListeners() {
        this.domElement.addEventListener('contextmenu', this.onContextMenu.bind(this));
        this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
        this.domElement.addEventListener('pointercancel', this.onPointerUp.bind(this));
        this.domElement.addEventListener('wheel', this.onMouseWheel.bind(this), { passive: false });
        this.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
    }
    // 이벤트 리스너 제거
    removeEventListeners() {
        this.domElement.removeEventListener('contextmenu', this.onContextMenu.bind(this));
        this.domElement.removeEventListener('pointerdown', this.onPointerDown.bind(this));
        this.domElement.removeEventListener('pointercancel', this.onPointerUp.bind(this));
        this.domElement.removeEventListener('wheel', this.onMouseWheel.bind(this));
        this.domElement.removeEventListener('pointermove', this.onPointerMove.bind(this));
        this.domElement.removeEventListener('pointerup', this.onPointerUp.bind(this));
    }

    async loadGraphAndPaths(graphCamName,graphName) {
        if (this.isGraphLoaded) {
            console.log("Data already loaded, skipping");
            return Promise.resolve(true);
        }
        try {
            // 경로가 제대로 전달되었는지 확인
            if (!graphCamName || !graphName) {
                console.error('Invalid graphCamName or graphName');
                return Promise.reject("sssssssssssssssssssssssssssssssssssssss");
            } 
            console.log("1")

            // 데이터 로드
            this.graphConnections = await this.loadGraph(graphName);
            this.graphPoints = await this.loadGraphCam(graphCamName);
            // 하드코딩
            // this.graphConnections = await this.loadGraph('assets/data/cafe/cafe_graph.txt');
            // this.graphPoints = await this.loadGraphCam('assets/data/cafe/cafe_centers.txt');
            
            if (!this.graphConnections || this.graphConnections.length === 0) {
                console.error("Graph Connections are empty or undefined");
                return Promise.reject(false);
            }else{
                console.log("Graph Connections loaded successfully")
            }

            if (!this.graphPoints || this.graphPoints.length === 0) {
                console.error("Graph Points are empty or undefined");
                return Promise.resolve(false);
            }else {
                console.log("Graph Points loaded successfully");
            }

            this.roads = this.createRoads(this.graphConnections, this.graphPoints);
            if (!this.roads || this.roads.length === 0) {
                throw new Error("Roads are empty or undefined");
            }

            this.isDataLoaded = true;
            if(this.roads.length!=0){
                this.isGraphLoaded = true;
                console.log(this.roads.length)
                return Promise.resolve(true); // 명시적으로 true 반환
            }
            console.log("Data loaded, starting animation...");
            console.log("2")

        } catch (error) {
            console.error('Error loading graph and paths:', error);
            this.isDataLoaded = false; // 오류 발생 시 데이터 상태를 명확히
            this.roads = null; // roads 상태도 명확히 초기화
        }
    }
    createRoads = (connections, points) => {
        const roads = connections.map(conn => {
            const start = points[conn.from];
            const end = points[conn.to];
    
            if (!start || !end) {
                console.error(`Invalid connection: start or end is undefined for connection from ${conn.from} to ${conn.to}`);
                return null; // null을 반환하여 이 경로를 건너뜀
            }     
    
            return {
                centerStart: start,
                centerEnd: end
            };
        }).filter(road => road !== null); // 유효하지 않은 로드 제거
    
        console.log(`Created ${roads.length} roads from connections.`);
        return roads;
    };


    // loadGraph, loadGraphCam 메서드는 기존과 동일
    async loadGraphCam(filePath){
        try {
            console.log('Attempting to load file from:', filePath); // 경로 확인용 로그

            const response = await fetch(filePath);
            if (!response.ok) {
                throw new Error('Failed to fetch file: ' + filePath);
            }
            const text = await response.text();
            // HTML이 포함된 파일이 아닌지 확인 (기본적으로 텍스트 파일이어야 함)
            if (text.includes('<html>')) {
                throw new Error('Loaded file is an HTML file. Expected a text file.');
            }
            // const points = text.split('\n').map(line => {
            //     const [x, y, z] = line.split(' ').map(Number);
            //     return new Vector3(x, y, z); // THREE.Vector3로 변경
            // });

            // //console.log('Loaded graphCam points:', points); // 로그 출력
            // return points;
            const points = text.split('\n').map((line, index) => {
                const trimmedLine = line.trim(); // 공백 제거
                if (trimmedLine === '') return null; // 빈 줄은 무시
    
                const coords = trimmedLine.split(' ').map(Number); // 공백 기준으로 분리
                if (coords.length === 3 && coords.every(num => !isNaN(num))) {
                    // x, y, z가 모두 숫자일 때만 Vector3로 변환
                    return new Vector3(...coords);
                } else {
                    // 유효하지 않은 데이터는 null 반환
                    console.warn(`Invalid line skipped at index ${index}: ${trimmedLine}`);
                    return null;
                }
            }).filter(point => point !== null); // null 값을 제거

            return points;
        } catch (error) {
            console.error('Error loading graphCam:', error);
            return []; // 오류 발생 시 빈 배열 반환

        }
    }

    // graph 데이터를 로드하는 함수
    async loadGraph(filePath){
        try {
            console.log('Attempting to load file from:', filePath); // 경로 확인용 로그
    
            const response = await fetch(filePath);
            
            // 요청이 실패한 경우 에러 처리
            if (!response.ok) {
                throw new Error('Failed to fetch file: ' + filePath);
            }
    
            // 응답의 Content-Type이 텍스트 파일인지 확인
            const contentType = response.headers.get("Content-Type");
            if (!contentType || !contentType.includes("text/plain")) {
                //throw new Error('Expected a plain text file, but got: ' + contentType);
            }
    
            const text = await response.text();
    
            const connections = text.split('\n').map((line, index) => {
                line = line.trim(); // 공백 제거 및 빈 줄 체크
    
                if (line === '') return null; // 빈 줄이면 null 반환
    
                const parts = line.split(' ').map(Number); // 공백으로 나눈 후 숫자로 변환
                
                // 유효성 검사: parts 배열이 길이 2가 아니거나, NaN이 포함된 경우 건너뜀
                if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                    console.warn(`Invalid line skipped at index ${index}: ${line}`); // 잘못된 줄을 건너뜀
                    return null;
                }
    
                return { from: parts[0], to: parts[1] };
            }).filter(conn => conn !== null); // 유효하지 않은 연결을 필터링
    
            // console.log('Loaded graph connections:', connections); // 로그 출력
            return connections;
        } catch (error) {
            console.error('Error loading graph:', error);
            return null;
        }
    }
    async raypoint(originCursor) {
        // origin 값이 전달되었는지 확인
        if (originCursor) {
            //console.log("Raypoint called with origin:", originCursor);
            this.originCursor = originCursor;
            // 여기에 origin 값을 사용한 추가 로직을 구현
        } else {
            console.error("Origin value not provided");
        }
    }
    // BFS를 이용한 최단 경로 찾기 함수
    calculateShortestPathBFS(graphConnections, graphPoints, startIdx, targetIdx) {
        const queue = [startIdx]; // 탐색할 노드를 담는 큐
        const cameFrom = new Map(); // 경로 추적용 맵
        const visited = new Set(); // 방문한 노드 기록
        visited.add(startIdx); // 시작 노드 방문 기록

        while (queue.length > 0) {
            const currentIdx = queue.shift(); // 큐에서 첫 번째 노드를 꺼냄

            // 목표 노드에 도달한 경우 경로 재구성
            if (currentIdx === targetIdx) {
                return this.reconstructPath(cameFrom, currentIdx);
            }

            // 현재 노드와 연결된 모든 이웃을 확인
            graphConnections.forEach(({ from, to }) => {
                const neighborIdx = (from === currentIdx) ? to : (to === currentIdx ? from : null);
                if (neighborIdx !== null && !visited.has(neighborIdx)) {
                    visited.add(neighborIdx); // 방문 기록
                    queue.push(neighborIdx); // 큐에 추가
                    cameFrom.set(neighborIdx, currentIdx); // 경로 추적
                }
            });
        }

        return []; // 목표 노드에 도달할 수 없는 경우 빈 배열 반환
    }

    // 경로 재구성 함수
    reconstructPath(cameFrom, currentIdx) {
        const totalPath = [currentIdx];
        while (cameFrom.has(currentIdx)) {
            currentIdx = cameFrom.get(currentIdx);
            totalPath.push(currentIdx);
        }
        return totalPath.reverse(); // 경로를 역순으로 반환
    }
    // // 다익스트라
    // calculateShortestPath(graphConnections, graphPoints, startIdx, targetIdx) {
    //     const distances = Array(graphPoints.length).fill(Infinity);
    //     const previousNodes = Array(graphPoints.length).fill(null);
    //     const visited = new Set();
    //     const queue = [];
    
    //     // 시작점의 거리와 초기화
    //     distances[startIdx] = 0;
    //     queue.push({ index: startIdx, distance: 0 });

    //     while (queue.length > 0) {
    //         // 우선순위 큐처럼 사용
    //         const { index: currentIdx } = queue.shift();
    //         if (visited.has(currentIdx)) continue;
    //         visited.add(currentIdx);
    
    //         // 현재 노드와 연결된 모든 이웃을 확인
    //         graphConnections.forEach(({ from, to }) => {
    //             if (from === currentIdx || to === currentIdx) {
    //                 const neighborIdx = (from === currentIdx) ? to : from;
    //                 const distance = graphPoints[currentIdx].distanceTo(graphPoints[neighborIdx]);
    
    //                 // 더 짧은 경로를 찾으면 업데이트
    //                 if (distances[currentIdx] + distance < distances[neighborIdx]) {
    //                     distances[neighborIdx] = distances[currentIdx] + distance;
    //                     previousNodes[neighborIdx] = currentIdx;
    //                     queue.push({ index: neighborIdx, distance: distances[neighborIdx] });
    //                 }
    //             }
    //         });
    //     }
    
    //     // 목표점에서 시작하여 역으로 경로를 추적
    //     const path = [];
    //     for (let at = targetIdx; at !== null; at = previousNodes[at]) {
    //         path.push(at);
    //     }
    //     return path.reverse(); // 경로는 역순으로 저장되므로 뒤집어 반환
    // }

    // ray로 찍은 위치와 가장 가까운 그래프포인트 찾기
    moveCameraToClosestGraphPoint() {
        if (!this.originCursor || !this.graphPoints) {
            console.error("OriginCursor 또는 graphPoints가 정의되지 않았습니다.");
            return;
        }
    
        //let closestPoint = null;
        let closestPointIndex = null;
        let closestDistance = Infinity;
    
        // 가장 가까운 포인트 찾기
        this.graphPoints.forEach((point, idx) => {
            const distance = point.distanceTo(this.originCursor); // originCursor와의 거리 계산
            if (distance < closestDistance) {
                closestDistance = distance;
                closestPointIndex = idx;
                //closestPoint = point;
            }
        });

        // 현재 카메라 위치에서 가장 가까운 포인트 찾기
        let currentClosestPointIndex = null;
        let currentClosestDistance = Infinity;
        this.graphPoints.forEach((point, idx) => {
            const distance = point.distanceTo(this.object.position);
            if (distance < currentClosestDistance) {
                currentClosestDistance = distance;
                currentClosestPointIndex = idx;
            }
        });
        if (closestPointIndex !== null && currentClosestPointIndex !== null) {
            // 최단 경로 계산 및 카메라 이동 시작
            const path = this.calculateShortestPathBFS(this.graphConnections, this.graphPoints, currentClosestPointIndex, closestPointIndex);
            this.animateCameraAlongPath(path);
        } else {
            console.error("가까운 포인트를 찾을 수 없습니다.");
        }
        // // 가장 가까운 포인트로 카메라 이동
        // if (closestPoint) {
        //     console.log("가장 가까운 포인트:", closestPoint);
        //     this.animateCameraToPoint(closestPoint); 
        //     //this.object.position.set(closestPoint.x, closestPoint.y, closestPoint.z);
        // } else {
        //     console.error("가까운 포인트를 찾을 수 없습니다.");
        // }
    }
    // 카메라를 최단 경로로 이동시키는 함수
    animateCameraAlongPath(path) {
        if (path.length === 0) return;
        
        let index = 0;
        const duration = 1.5; // 각 구간 이동 시간 (초 단위)
        const moveToNextPoint = () => {
            if (index >= path.length - 1) {
                console.log("카메라 경로 이동 완료");
                return;
            }

            const startPoint = this.graphPoints[path[index]];
            const endPoint = this.graphPoints[path[index + 1]];
            const startTime = performance.now();

            const animate = (time) => {
                const elapsed = (time - startTime) / 1000;
                const t = Math.min(elapsed / duration, 1);

                // lerp를 사용하여 카메라 위치 보간
                this.object.position.lerpVectors(startPoint, endPoint, t);

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    index++;
                    moveToNextPoint(); // 다음 포인트로 이동
                }
            };

            requestAnimationFrame(animate); // 애니메이션 시작
        };

        moveToNextPoint(); // 첫 번째 이동 시작
    }
    // animateCameraToPoint(targetPoint) {
    //     this.startPosition = this.object.position.clone(); // 현재 카메라 위치
    //     this.targetPosition = targetPoint.clone(); // 목표 위치
    //     this.startTime = performance.now(); // 애니메이션 시작 시간
    //     this.isMoving = true; // 카메라 이동 중임을 표시
    // }



    // 새로운 메서드 추가 그래프가 없을 때,
    async loadBoundaryPoints(filePath){
        try {
            console.log(filePath);
            const response = await fetch(filePath);
            const text = await response.text();
            const lines = text.trim().split('\n');
            
            this.boundaryPoints = lines.map(line => {
                const [x, y, z] = line.split(' ').map(Number);
                return new Vector2(x, y);
            });
            
            this.calculateConvexHull();
            this.enableBoundary = true;
        } catch (error) {
            console.error('경계점 로드 중 오류:', error);
        }
    };

    calculateConvexHull(){
        // Graham Scan 알고리즘을 사용한 Convex Hull 계산
        const points = this.boundaryPoints;
        
        // 가장 아래 왼쪽 점 찾기
        let start = points[0];
        for (let i = 1; i < points.length; i++) {
            if (points[i].y < start.y || (points[i].y === start.y && points[i].x < start.x)) {
                start = points[i];
            }
        }

        // 각도에 따라 정렬
        points.sort((a, b) => {
            const angle = Math.atan2(a.y - start.y, a.x - start.x) - Math.atan2(b.y - start.y, b.x - start.x);
            return angle || a.distanceTo(start) - b.distanceTo(start);
        });

        // Convex Hull 계산
        this.convexHull = [start, points[1]];
        for (let i = 2; i < points.length; i++) {
            while (this.convexHull.length > 1 && this.ccw(this.convexHull[this.convexHull.length - 2], this.convexHull[this.convexHull.length - 1], points[i]) <= 0) {
                this.convexHull.pop();
            }
            this.convexHull.push(points[i]);
        }
        console.log(this.convexHull)
    };

    ccw(a, b, c){
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    };

    isInsideBoundary(point){
        if (!this.enableBoundary) return true;

        const hull = this.convexHull;
        let inside = false;
        for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
            const xi = hull[i].x, yi = hull[i].y;
            const xj = hull[j].x, yj = hull[j].y;
            
            const intersect = ((yi > point.y) !== (yj > point.y))
                && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    getClosestPointOnBoundary(point){
        const hull = this.convexHull;
        let closestPoint = hull[0];
        let minDistance = point.distanceTo(hull[0]);

        for (let i = 1; i < hull.length; i++) {
            const distance = point.distanceTo(hull[i]);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = hull[i];
            }
        }

        return closestPoint;
    };

}
// OrbitControls 생성 및 초기화 함수
async function createOrbitControls(camera, domElement, graphCamName, graphName, viewer) {
    const controls = new OrbitControls(camera, domElement, graphCamName, graphName);
    //await controls.loadBoundaryPoints(boundaryFilePath);
    console.log(graphName)

    controls.loadGraphAndPaths(graphCamName,graphName)
    controls.loadBoundaryPoints(graphCamName)
    return controls;
}

export { OrbitControls, createOrbitControls };
