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
    CatmullRomCurve3,
    Matrix4,
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    SphereGeometry,
    MeshBasicMaterial,
    Mesh
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

    constructor( object, domElement ) {

        super();

        this.object = object;
        this.domElement = domElement;
        this.domElement.style.touchAction = 'none'; // disable touch scroll

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
        this.currentPathIndex = 0; // 현재 경로 인덱스
        this.pathProgress = 0; 
        // clock을 클래스의 멤버로 정의
        this.clock = new Clock();


        this.graph = new Map(); // 그래프 구조를 저장할 Map
        this.currentNode = null; // 현재 위치한 노드
        this.targetNode = null; // 목표 노드
        this.movementSpeed = 0.1;
        this.rotationSpeed = 0.05;
        this.graphPoints = [];
        

        this.getPolarAngle = function() {

            return spherical.phi;

        };

        this.getAzimuthalAngle = function() {

            return spherical.theta;

        };

        this.getDistance = function() {

            return this.object.position.distanceTo( this.target );

        };

        this.listenToKeyEvents = function( domElement ) {

            //domElement.addEventListener( 'keydown', onKeyDown );

            //0829
            domElement.addEventListener('keydown', handleKeyDown);
            domElement.addEventListener('keyup', handleKeyUp);
            domElement.addEventListener('keydown', this.animate);
            
            this._domElementKeyEvents = domElement;

        };

        this.stopListenToKeyEvents = function() {

            this._domElementKeyEvents.removeEventListener( 'keydown', onKeyDown );
            this._domElementKeyEvents = null;

        };

        this.saveState = function() {

            scope.target0.copy( scope.target );
            scope.position0.copy( scope.object.position );
            scope.zoom0 = scope.object.zoom;

        };

        this.reset = function() {

            scope.target.copy( scope.target0 );
            scope.object.position.copy( scope.position0 );
            scope.object.zoom = scope.zoom0;
            this.clearDampedRotation();
            this.clearDampedPan();

            scope.object.updateProjectionMatrix();
            scope.dispatchEvent( _changeEvent );

            scope.update();

            state = STATE.NONE;

        };

        this.clearDampedRotation = function() {
            sphericalDelta.theta = 0.0;
            sphericalDelta.phi = 0.0;
        };

        this.clearDampedPan = function() {
            panOffset.set(0, 0, 0);
        };

        // this method is exposed, but perhaps it would be better if we can make it private...
        this.update = function() {

            const offset = new Vector3();

            // so camera.up is the orbit axis
            const quat = new Quaternion().setFromUnitVectors( object.up, new Vector3( 0, 1, 0 ) );
            const quatInverse = quat.clone().invert();

            const lastPosition = new Vector3();
            const lastQuaternion = new Quaternion();
            const lastTargetPosition = new Vector3();

            const twoPI = 2 * Math.PI;

            return function update() {

                quat.setFromUnitVectors( object.up, new Vector3( 0, 1, 0 ) );
                quatInverse.copy(quat).invert();

                const position = scope.object.position;

                const forwardDirection = new Vector3(0, 0, -0.0000001).applyQuaternion(this.object.quaternion);
            
                // Set the target to be slightly in front of the camera
                this.target.copy(position).addScaledVector(forwardDirection, this.forwardOffset);
    

                offset.copy( position ).sub( scope.target );

                // rotate offset to "y-axis-is-up" space
                offset.applyQuaternion( quat );

                // angle from z-axis around y-axis
                spherical.setFromVector3( offset );

                if ( scope.autoRotate && state === STATE.NONE ) {

                    rotateLeft( getAutoRotationAngle() );

                }

                if ( scope.enableDamping ) {

                    spherical.theta += sphericalDelta.theta * scope.dampingFactor;
                    spherical.phi += sphericalDelta.phi * scope.dampingFactor;

                } else {

                    spherical.theta += sphericalDelta.theta;
                    spherical.phi += sphericalDelta.phi;

                }

                // restrict theta to be between desired limits

                let min = scope.minAzimuthAngle;
                let max = scope.maxAzimuthAngle;

                if ( isFinite( min ) && isFinite( max ) ) {

                    if ( min < - Math.PI ) min += twoPI; else if ( min > Math.PI ) min -= twoPI;

                    if ( max < - Math.PI ) max += twoPI; else if ( max > Math.PI ) max -= twoPI;

                    if ( min <= max ) {

                        spherical.theta = Math.max( min, Math.min( max, spherical.theta ) );

                    } else {

                        spherical.theta = ( spherical.theta > ( min + max ) / 2 ) ?
                            Math.max( min, spherical.theta ) :
                            Math.min( max, spherical.theta );

                    }

                }


                // restrict theta to be between desired limits
                spherical.theta = Math.max( this.minAzimuthAngle, Math.min( this.maxAzimuthAngle, spherical.theta ) );

                // restrict phi to be between desired limits
                spherical.phi = Math.max( scope.minPolarAngle, Math.min( scope.maxPolarAngle, spherical.phi ) );

                spherical.makeSafe();


                // move target to panned location

                if ( scope.enableDamping === true ) {

                    scope.target.addScaledVector( panOffset, scope.dampingFactor );

                } else {

                    scope.target.add( panOffset );

                }

                // adjust the camera position based on zoom only if we're not zooming to the cursor or if it's an ortho camera
                // we adjust zoom later in these cases
                if ( scope.zoomToCursor && performCursorZoom || scope.object.isOrthographicCamera ) {

                    spherical.radius = clampDistance( spherical.radius );

                } else {

                    spherical.radius = clampDistance( spherical.radius * scale );

                }


                offset.setFromSpherical( spherical );

                // rotate offset back to "camera-up-vector-is-up" space
                offset.applyQuaternion( quatInverse );

                position.copy( scope.target ).add( offset );

                scope.object.lookAt( scope.target );

                if ( scope.enableDamping === true ) {

                    sphericalDelta.theta *= ( 1 - scope.dampingFactor );
                    sphericalDelta.phi *= ( 1 - scope.dampingFactor );

                    panOffset.multiplyScalar( 1 - scope.dampingFactor );

                } else {

                    sphericalDelta.set( 0, 0, 0 );

                    panOffset.set( 0, 0, 0 );

                }

                // adjust camera position
                let zoomChanged = false;
                if ( scope.zoomToCursor && performCursorZoom ) {

                    let newRadius = null;
                    if ( scope.object.isPerspectiveCamera ) {

                        // move the camera down the pointer ray
                        // this method avoids floating point error
                        const prevRadius = offset.length();
                        newRadius = clampDistance( prevRadius * scale );

                        const radiusDelta = prevRadius - newRadius;
                        scope.object.position.addScaledVector( dollyDirection, radiusDelta );
                        scope.object.updateMatrixWorld();

                    } else if ( scope.object.isOrthographicCamera ) {

                        // adjust the ortho camera position based on zoom changes
                        const mouseBefore = new Vector3( mouse.x, mouse.y, 0 );
                        mouseBefore.unproject( scope.object );

                        scope.object.zoom = Math.max( scope.minZoom, Math.min( scope.maxZoom, scope.object.zoom / scale ) );
                        scope.object.updateProjectionMatrix();
                        zoomChanged = true;

                        const mouseAfter = new Vector3( mouse.x, mouse.y, 0 );
                        mouseAfter.unproject( scope.object );

                        scope.object.position.sub( mouseAfter ).add( mouseBefore );
                        scope.object.updateMatrixWorld();

                        newRadius = offset.length();

                    } else {

                        console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.' );
                        scope.zoomToCursor = false;

                    }

                    // handle the placement of the target
                    if ( newRadius !== null ) {

                        if ( this.screenSpacePanning ) {

                            // position the orbit target in front of the new camera position
                            scope.target.set( 0, 0, - 1 )
                                .transformDirection( scope.object.matrix )
                                .multiplyScalar( newRadius )
                                .add( scope.object.position );

                        } else {

                            // get the ray and translation plane to compute target
                            _ray.origin.copy( scope.object.position );
                            _ray.direction.set( 0, 0, - 1 ).transformDirection( scope.object.matrix );

                            // if the camera is 20 degrees above the horizon then don't adjust the focus target to avoid
                            // extremely large values
                            if ( Math.abs( scope.object.up.dot( _ray.direction ) ) < TILT_LIMIT ) {

                                object.lookAt( scope.target );

                            } else {

                                _plane.setFromNormalAndCoplanarPoint( scope.object.up, scope.target );
                                _ray.intersectPlane( _plane, scope.target );

                            }

                        }

                    }

                } else if ( scope.object.isOrthographicCamera ) {

                    scope.object.zoom = Math.max( scope.minZoom, Math.min( scope.maxZoom, scope.object.zoom / scale ) );
                    scope.object.updateProjectionMatrix();
                    zoomChanged = true;

                }

                scale = 1;
                performCursorZoom = false;

                // update condition is:
                // min(camera displacement, camera rotation in radians)^2 > EPS
                // using small-angle approximation cos(x/2) = 1 - x^2 / 8

                if ( zoomChanged ||
                    // lastPosition.distanceToSquared( scope.object.position ) > EPS ||
                    // 8 * ( 1 - lastQuaternion.dot( scope.object.quaternion ) ) > EPS ||
                    // lastTargetPosition.distanceToSquared( scope.target ) > 0 ) {

                    lastPosition.distanceToSquared( this.object.position ) > EPS ||
                    8 * ( 1 - lastQuaternion.dot( this.object.quaternion ) ) > EPS ) {
                    scope.dispatchEvent( _changeEvent );

                    lastPosition.copy( scope.object.position );
                    lastQuaternion.copy( scope.object.quaternion );
                    lastTargetPosition.copy( scope.target );

                    zoomChanged = false;

                    return true;

                }

                return false;

            
            };

        }();

        this.dispose = function() {

            scope.domElement.removeEventListener( 'contextmenu', onContextMenu );

            scope.domElement.removeEventListener( 'pointerdown', onPointerDown );
            scope.domElement.removeEventListener( 'pointercancel', onPointerUp );
            scope.domElement.removeEventListener( 'wheel', onMouseWheel );

            scope.domElement.removeEventListener( 'pointermove', onPointerMove );
            scope.domElement.removeEventListener( 'pointerup', onPointerUp );


            if ( scope._domElementKeyEvents !== null ) {

                scope._domElementKeyEvents.removeEventListener( 'keydown', onKeyDown );
                scope._domElementKeyEvents = null;

            }

        };

        //
        // internals
        //

        const scope = this;

        const STATE = {
            NONE: - 1,
            ROTATE: 0,
            DOLLY: 1,
            PAN: 2,
            TOUCH_ROTATE: 3,
            TOUCH_PAN: 4,
            TOUCH_DOLLY_PAN: 5,
            TOUCH_DOLLY_ROTATE: 6
        };

        let state = STATE.NONE;

        const EPS = 0.000001;

        // current position in spherical coordinates
        const spherical = new Spherical();
        const sphericalDelta = new Spherical();

        let scale = 1;
        const panOffset = new Vector3();

        const rotateStart = new Vector2();
        const rotateEnd = new Vector2();
        const rotateDelta = new Vector2();

        const panStart = new Vector2();
        const panEnd = new Vector2();
        const panDelta = new Vector2();

        const dollyStart = new Vector2();
        const dollyEnd = new Vector2();
        const dollyDelta = new Vector2();

        const dollyDirection = new Vector3();
        const mouse = new Vector2();
        let performCursorZoom = false;

        const pointers = [];
        const pointerPositions = {};

        function getAutoRotationAngle() {

            return 2 * Math.PI / 60 / 60 * scope.autoRotateSpeed;

        }

        function getZoomScale() {

            return Math.pow( 0.95, scope.zoomSpeed );

        }

        function rotateLeft( angle ) {

            sphericalDelta.theta -= angle;

        }
        function rotateRight( angle ) {

            sphericalDelta.theta = angle;

        }
        function rotateUp( angle ) {

            sphericalDelta.phi -= angle;

        }

        const panLeft = function() {

            const v = new Vector3();

            return function panLeft( distance, objectMatrix ) {

                v.setFromMatrixColumn( objectMatrix, 0 ); // get X column of objectMatrix
                v.multiplyScalar( - distance );
                
                panOffset.add( v );

            };

        }();

        const panUp = function() {

            const v = new Vector3();

            return function panUp( distance, objectMatrix ) {

                if ( scope.screenSpacePanning === true ) {

                    v.setFromMatrixColumn( objectMatrix, 1 );

                } else {

                    v.setFromMatrixColumn( objectMatrix, 0 );
                    v.crossVectors( scope.object.up, v );

                }

                v.multiplyScalar( distance );
                
                panOffset.add( v );

            };

        }();

        // deltaX and deltaY are in pixels; right and down are positive
        const pan = function() {

            const offset = new Vector3();

            return function pan( deltaX, deltaY ) {

                const element = scope.domElement;

                if ( scope.object.isPerspectiveCamera ) {

                    // perspective
                    const position = scope.object.position;
                    offset.copy( position ).sub( scope.target );
                    let targetDistance = offset.length();

                    // half of the fov is center to top of screen
                    targetDistance *= Math.tan( ( scope.object.fov / 2 ) * Math.PI / 180.0 );

                    // we use only clientHeight here so aspect ratio does not distort speed
                    panLeft( 2 * deltaX * targetDistance / element.clientHeight, scope.object.matrix );
                    panUp( 2 * deltaY * targetDistance / element.clientHeight, scope.object.matrix );

                } else if ( scope.object.isOrthographicCamera ) {

                    // orthographic
                    panLeft( deltaX * ( scope.object.right - scope.object.left ) /
                                        scope.object.zoom / element.clientWidth, scope.object.matrix );
                    panUp( deltaY * ( scope.object.top - scope.object.bottom ) / scope.object.zoom /
                                      element.clientHeight, scope.object.matrix );

                } else {

                    // camera neither orthographic nor perspective
                    console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.' );
                    scope.enablePan = false;

                }

            };

        }();
        //Move 0829
        
        function moveOut(moveSpeed){
            const movementDirection = new Vector3();
            scope.object.getWorldDirection(movementDirection);
            movementDirection.z = 0; // Set z component to 0
            movementDirection.normalize(); // Renormalize the vector
            scope.object.position.addScaledVector(movementDirection, -moveSpeed);
        }
        function moveIn(moveSpeed){
            const movementDirection = new Vector3();
            scope.object.getWorldDirection(movementDirection);
            movementDirection.z = 0; // Set z component to 0
            movementDirection.normalize(); // Renormalize the vector
            scope.object.position.addScaledVector(movementDirection, moveSpeed);
        }
        function moveLeft(moveSpeed){
            const movementDirection = new Vector3();
            scope.object.getWorldDirection(movementDirection);
            movementDirection.z = 0; // Set z component to 0
            movementDirection.normalize(); // Renormalize the vector

            // 카메라의 오른쪽 방향 계산
            const leftVector = new Vector3();
            leftVector.crossVectors(movementDirection, scope.object.up).normalize();
            scope.object.position.addScaledVector(leftVector, -moveSpeed);
        }
        function moveRight(moveSpeed){
            const movementDirection = new Vector3();
            scope.object.getWorldDirection(movementDirection);
            movementDirection.z = 0; // Set z component to 0
            movementDirection.normalize(); // Renormalize the vector

            // 카메라의 오른쪽 방향 계산
            const rightVector = new Vector3();
            rightVector.crossVectors(movementDirection, scope.object.up).normalize();
            scope.object.position.addScaledVector(rightVector, moveSpeed);
        }


        function dollyOut( dollyScale ) {

            if ( scope.object.isPerspectiveCamera || scope.object.isOrthographicCamera ) {

                scale /= dollyScale;

            } else {

                console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.' );
                scope.enableZoom = false;

            }

        }


        function dollyIn( dollyScale ) {


            if ( scope.object.isPerspectiveCamera || scope.object.isOrthographicCamera ) {

                scale *= dollyScale;

            } else {

                console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.' );
                scope.enableZoom = false;

            }

        }

        function updateMouseParameters( event ) {

            if ( ! scope.zoomToCursor ) {

                return;

            }

            performCursorZoom = true;

            const rect = scope.domElement.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const w = rect.width;
            const h = rect.height;

            mouse.x = ( x / w ) * 2 - 1;
            mouse.y = - ( y / h ) * 2 + 1;

            dollyDirection.set( mouse.x, mouse.y, 1 ).unproject( object ).sub( object.position ).normalize();

        }

        function clampDistance( dist ) {

            return Math.max( scope.minDistance, Math.min( scope.maxDistance, dist ) );

        }

        //
        // event callbacks - update the object state
        //

        function handleMouseDownRotate( event ) {

            rotateStart.set( event.clientX, event.clientY );

        }

        function handleMouseDownDolly( event ) {

            updateMouseParameters( event );
            dollyStart.set( event.clientX, event.clientY );

        }

        function handleMouseDownPan( event ) {

            panStart.set( event.clientX, event.clientY );

        }

        function handleMouseMoveRotate( event ) {

            rotateEnd.set( event.clientX, event.clientY );

            rotateDelta.subVectors( rotateEnd, rotateStart ).multiplyScalar( scope.rotateSpeed );

            const element = scope.domElement;

            rotateLeft( 2 * Math.PI * rotateDelta.x / element.clientHeight ); // yes, height

            rotateUp( 2 * Math.PI * rotateDelta.y / element.clientHeight );

            rotateStart.copy( rotateEnd );

            scope.update();

        }

        function handleMouseMoveDolly( event ) {

            dollyEnd.set( event.clientX, event.clientY );

            dollyDelta.subVectors( dollyEnd, dollyStart );

            if ( dollyDelta.y > 0 ) {

                dollyOut( getZoomScale() );

            } else if ( dollyDelta.y < 0 ) {

                dollyIn( getZoomScale() );

            }

            dollyStart.copy( dollyEnd );

            scope.update();

        }

        function handleMouseMovePan( event ) {

            panEnd.set( event.clientX, event.clientY );

            panDelta.subVectors( panEnd, panStart ).multiplyScalar( scope.panSpeed );

            pan( panDelta.x, panDelta.y );

            panStart.copy( panEnd );

            scope.update();

        }

        function handleMouseWheel( event ) {

            updateMouseParameters( event );

            if ( event.deltaY < 0 ) {

                dollyIn( getZoomScale() );

            } else if ( event.deltaY > 0 ) {

                dollyOut( getZoomScale() );

            }

            scope.update();

        }


        //0829
        const keysPressed = {
            UP: false,
            DOWN: false,
            LEFT: false,
            RIGHT: false
        };
        function handleKeyDown( event ) {
            switch ( event.code ) {

                case scope.keys.UP:
                    keysPressed.UP = true;
                    break;

                case scope.keys.BOTTOM:     
                    keysPressed.DOWN = true;
                    break;

                case scope.keys.LEFT:
                    keysPressed.LEFT = true;
                    break;

                case scope.keys.RIGHT:
                    keysPressed.RIGHT = true;
                    break;
            }
            event.preventDefault();
        }
        function handleKeyUp(event) {
            switch (event.code) {
                case scope.keys.UP:
                    keysPressed.UP = false;
                    break;
                case scope.keys.BOTTOM:
                    keysPressed.DOWN = false;
                    break;
                case scope.keys.LEFT:
                    keysPressed.LEFT = false;
                    break;
                case scope.keys.RIGHT:
                    keysPressed.RIGHT = false;
                    break;
            }
            event.preventDefault();
        }
        const baseMoveSpeed = 0.01; // 기본 이동 속도

        this.updateCameraMovement = (deltaTime) => {
            if (!this.isDataLoaded) {  // 데이터 및 경로 로드 상태 확인
                return;
            }
            const moveSpeed = baseMoveSpeed * deltaTime;

            if (keysPressed.UP) {
                this.moveInDirectionOfView();
                //this.moveAlongGraph('forward');

                //moveIn(moveSpeed);
                //console.log("test");
            }
            if (keysPressed.DOWN) {
                //this.moveAlongGraph('backward');
                //moveOut(moveSpeed);
            }
            if (keysPressed.LEFT) {
                //moveLeft(moveSpeed);
            }
            if (keysPressed.RIGHT) {
                moveRight(moveSpeed);
            }
        };

        // animate 메서드도 생성자 내부에 정의하고 this에 바인딩
        this.animate = () => {
            if (this.clock) {
                const deltaTime = this.clock.getDelta();
                this.updateCameraMovement(deltaTime);
            }
            requestAnimationFrame(this.animate);
        };

        // 초기화 및 애니메이션 시작
        this.loadGraphAndPaths().then(() => {
            this.animate();
        });


        // function handleKeyDown( event ) {
        //     let needsUpdate = false;
        //     switch ( event.code ) {

        //         case scope.keys.UP:
        //             moveIn();
        //             needsUpdate = true;
        //             break;

        //         case scope.keys.BOTTOM:     
        //             moveOut();
        //             needsUpdate = true;
        //             break;

        //         case scope.keys.LEFT:

        //             moveLeft();
        //             needsUpdate = true;
        //             break;

        //         case scope.keys.RIGHT:
        //             moveRight();
        //             needsUpdate = true;
        //             break;
        //     }
        //     if ( needsUpdate ) {
        //         // prevent the browser from scrolling on cursor keys
        //         event.preventDefault();
        //         scope.update();
        //     }
        // }


        function handleTouchStartRotate() {

            if ( pointers.length === 1 ) {

                rotateStart.set( pointers[0].pageX, pointers[0].pageY );

            } else {

                const x = 0.5 * ( pointers[0].pageX + pointers[1].pageX );
                const y = 0.5 * ( pointers[0].pageY + pointers[1].pageY );

                rotateStart.set( x, y );

            }

        }

        function handleTouchStartPan() {

            if ( pointers.length === 1 ) {

                panStart.set( pointers[0].pageX, pointers[0].pageY );

            } else {

                const x = 0.5 * ( pointers[0].pageX + pointers[1].pageX );
                const y = 0.5 * ( pointers[0].pageY + pointers[1].pageY );

                panStart.set( x, y );

            }

        }

        function handleTouchStartDolly() {

            const dx = pointers[0].pageX - pointers[1].pageX;
            const dy = pointers[0].pageY - pointers[1].pageY;

            const distance = Math.sqrt( dx * dx + dy * dy );

            dollyStart.set( 0, distance );

        }

        function handleTouchStartDollyPan() {

            if ( scope.enableZoom ) handleTouchStartDolly();

            if ( scope.enablePan ) handleTouchStartPan();

        }

        function handleTouchStartDollyRotate() {

            if ( scope.enableZoom ) handleTouchStartDolly();

            if ( scope.enableRotate ) handleTouchStartRotate();

        }

        function handleTouchMoveRotate( event ) {

            if ( pointers.length == 1 ) {

                rotateEnd.set( event.pageX, event.pageY );

            } 
            // else {

            //     const position = getSecondPointerPosition( event );

            //     const x = 0.5 * ( event.pageX + position.x );
            //     const y = 0.5 * ( event.pageY + position.y );

            //     rotateEnd.set( x, y );

            // }

            rotateDelta.subVectors( rotateEnd, rotateStart ).multiplyScalar( scope.rotateSpeed );

            const element = scope.domElement;

            rotateLeft(-2 * Math.PI * rotateDelta.x / element.clientHeight ); // 반대로 바꿈

            rotateUp(2 * Math.PI * rotateDelta.y / element.clientHeight );

            rotateStart.copy( rotateEnd );

        }

        function handleTouchMovePan( event ) {

            if ( pointers.length === 1 ) {

                panEnd.set( event.pageX, event.pageY );

            } else {

                const position = getSecondPointerPosition( event );

                const x = 0.5 * ( event.pageX + position.x );
                const y = 0.5 * ( event.pageY + position.y );

                panEnd.set( x, y );

            }
            // 좌우 이동 감지
            panDelta.subVectors(panEnd, panStart).multiplyScalar(scope.panSpeed);

            if (panDelta.x > 0) {
                moveRight(panDelta.x); // 오른쪽으로 이동 시 moveRight 호출
            } else if (panDelta.x < 0) {
                moveLeft(panDelta.x); // 왼쪽으로 이동 시 moveLeft 호출
            }
            // pan( panDelta.x, panDelta.y );

            panStart.copy(panEnd);


        }

        function handleTouchMoveDolly( event ) {
            const position = getSecondPointerPosition(event);

            const dx = event.pageX - position.x;
            const dy = event.pageY - position.y;

            const distance = Math.sqrt(dx * dx + dy * dy);

            dollyEnd.set(0, distance);

            dollyDelta.set(0, Math.pow(dollyEnd.y / dollyStart.y, scope.zoomSpeed));

            if (dollyDelta.y < 1) {
                moveOut(dollyDelta.y);  // 줌을 줄일 때 moveOut 함수 호출
            } else if (dollyDelta.y > 1) {
                moveIn(dollyDelta.y);   // 줌을 할 때 moveIn 함수 호출
            }
            // dollyOut( dollyDelta.y );
            dollyStart.copy(dollyEnd);

        }

        function handleTouchMoveDollyPan( event ) {

            if ( scope.enableZoom ) handleTouchMoveDolly( event );

            if ( scope.enablePan ) handleTouchMovePan( event );

        }

        function handleTouchMoveDollyRotate( event ) {

            if ( scope.enableZoom ) handleTouchMoveDolly( event );

            if ( scope.enableRotate ) handleTouchMoveRotate( event );

        }

        //
        // event handlers - FSM: listen for events and reset state
        //

        function onPointerDown( event ) {

            if ( scope.enabled === false ) return;

            if ( pointers.length === 0 ) {

                scope.domElement.setPointerCapture( event.pointerId );

                scope.domElement.addEventListener( 'pointermove', onPointerMove );
                scope.domElement.addEventListener( 'pointerup', onPointerUp );

            }

            //

            addPointer( event );

            if ( event.pointerType === 'touch' ) {

                onTouchStart( event );

            } else {

                onMouseDown( event );

            }

        }

        function onPointerMove( event ) {

            if ( scope.enabled === false ) return;

            if ( event.pointerType === 'touch' ) {

                onTouchMove( event );

            } else {

                onMouseMove( event );

            }

        }

        function onPointerUp( event ) {

            removePointer( event );

            if ( pointers.length === 0 ) {

                scope.domElement.releasePointerCapture( event.pointerId );

                scope.domElement.removeEventListener( 'pointermove', onPointerMove );
                scope.domElement.removeEventListener( 'pointerup', onPointerUp );

            }

            scope.dispatchEvent( _endEvent );

            state = STATE.NONE;

        }

        function onMouseDown( event ) {

            let mouseAction;

            switch ( event.button ) {

                case 0:

                    mouseAction = scope.mouseButtons.LEFT;
                    break;

                case 1:

                    mouseAction = scope.mouseButtons.MIDDLE;
                    break;

                case 2:

                    mouseAction = scope.mouseButtons.RIGHT;
                    break;

                default:

                    mouseAction = - 1;

            }

            switch ( mouseAction ) {

                case MOUSE.DOLLY:

                    if ( scope.enableZoom === false ) return;

                    handleMouseDownDolly( event );

                    state = STATE.DOLLY;

                    break;

                case MOUSE.ROTATE:

                    if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

                        if ( scope.enablePan === false ) return;

                        handleMouseDownPan( event );

                        state = STATE.PAN;

                    } else {

                        if ( scope.enableRotate === false ) return;

                        handleMouseDownRotate( event );

                        state = STATE.ROTATE;

                    }

                    break;

                case MOUSE.PAN:

                    if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

                        if ( scope.enableRotate === false ) return;

                        handleMouseDownRotate( event );

                        state = STATE.ROTATE;

                    } else {

                        if ( scope.enablePan === false ) return;

                        handleMouseDownPan( event );

                        state = STATE.PAN;

                    }

                    break;

                default:

                    state = STATE.NONE;

            }

            if ( state !== STATE.NONE ) {

                scope.dispatchEvent( _startEvent );

            }

        }

        function onMouseMove( event ) {

            switch ( state ) {

                case STATE.ROTATE:

                    if ( scope.enableRotate === false ) return;

                    handleMouseMoveRotate( event );

                    break;

                case STATE.DOLLY:

                    if ( scope.enableZoom === false ) return;

                    handleMouseMoveDolly( event );

                    break;

                case STATE.PAN:

                    if ( scope.enablePan === false ) return;

                    handleMouseMovePan( event );

                    break;

            }

        }

        function onMouseWheel( event ) {

            if ( scope.enabled === false || scope.enableZoom === false || state !== STATE.NONE ) return;

            event.preventDefault();

            scope.dispatchEvent( _startEvent );

            handleMouseWheel( event );

            scope.dispatchEvent( _endEvent );

        }

        function onKeyDown( event ) {

            if ( scope.enabled === false || scope.enablePan === false ) return;

            handleKeyDown( event );

        }

        function onTouchStart( event ) {

            trackPointer( event );

            switch ( pointers.length ) {

                case 1:

                    switch ( scope.touches.ONE ) {

                        case TOUCH.ROTATE:

                            if ( scope.enableRotate === false ) return;

                            handleTouchStartRotate();

                            state = STATE.TOUCH_ROTATE;

                            break;

                        case TOUCH.PAN:

                            if ( scope.enablePan === false ) return;

                            handleTouchStartPan();

                            state = STATE.TOUCH_PAN;

                            break;

                        default:

                            state = STATE.NONE;

                    }

                    break;

                case 2:

                    switch ( scope.touches.TWO ) {

                        case TOUCH.DOLLY_PAN:

                            if ( scope.enableZoom === false && scope.enablePan === false ) return;

                            handleTouchStartDollyPan();

                            state = STATE.TOUCH_DOLLY_PAN;

                            break;

                        case TOUCH.DOLLY_ROTATE:

                            if ( scope.enableZoom === false && scope.enableRotate === false ) return;

                            handleTouchStartDollyRotate();

                            state = STATE.TOUCH_DOLLY_ROTATE;

                            break;

                        default:

                            state = STATE.NONE;

                    }

                    break;

                default:

                    state = STATE.NONE;

            }

            if ( state !== STATE.NONE ) {

                scope.dispatchEvent( _startEvent );

            }

        }

        function onTouchMove( event ) {

            trackPointer( event );

            switch ( state ) {

                case STATE.TOUCH_ROTATE:

                    if ( scope.enableRotate === false ) return;

                    handleTouchMoveRotate( event );

                    scope.update();

                    break;

                case STATE.TOUCH_PAN:

                    if ( scope.enablePan === false ) return;

                    handleTouchMovePan( event );

                    scope.update();

                    break;

                case STATE.TOUCH_DOLLY_PAN:

                    if ( scope.enableZoom === false && scope.enablePan === false ) return;

                    handleTouchMoveDollyPan( event );

                    scope.update();

                    break;

                case STATE.TOUCH_DOLLY_ROTATE:

                    if ( scope.enableZoom === false && scope.enableRotate === false ) return;

                    handleTouchMoveDollyRotate( event );

                    scope.update();

                    break;

                default:

                    state = STATE.NONE;

            }

        }

        function onContextMenu( event ) {

            if ( scope.enabled === false ) return;

            event.preventDefault();

        }

        function addPointer( event ) {

            pointers.push( event );

        }

        function removePointer( event ) {

            delete pointerPositions[event.pointerId];

            for ( let i = 0; i < pointers.length; i ++ ) {

                if ( pointers[i].pointerId == event.pointerId ) {

                    pointers.splice( i, 1 );
                    return;

                }

            }

        }

        function trackPointer( event ) {

            let position = pointerPositions[event.pointerId];

            if ( position === undefined ) {

                position = new Vector2();
                pointerPositions[event.pointerId] = position;

            }

            position.set( event.pageX, event.pageY );

        }

        function getSecondPointerPosition( event ) {

            const pointer = ( event.pointerId === pointers[0].pointerId ) ? pointers[1] : pointers[0];

            return pointerPositions[pointer.pointerId];

        }

        //

        scope.domElement.addEventListener( 'contextmenu', onContextMenu );

        scope.domElement.addEventListener( 'pointerdown', onPointerDown );
        scope.domElement.addEventListener( 'pointercancel', onPointerUp );
        scope.domElement.addEventListener( 'wheel', onMouseWheel, { passive: false } );
 
        // force an update at start

        this.update();
    
 

        // loadBoundaryPoints 함수 정의
        this.loadBoundaryPoints = async (filePath) => {
            try {
                const response = await fetch(filePath);
                const text = await response.text();
                const lines = text.trim().split('\n');

                // 텍스트 파일에서 좌표를 읽어들여 boundaryPoints로 변환
                this.boundaryPoints = lines.map(line => {
                    const [x, y, z] = line.split(' ').map(Number);
                    return new Vector3(x, y, z);
                });

                this.testtest = [...this.boundaryPoints];
                console.log('Boundary points:', this.testtest);
                this.isDataLoaded = true;  // 데이터 로드 완료

                this.calculateConvexHull();  // 볼록 껍질 계산 (구현 필요)
                this.enableBoundary = true;

            } catch (error) {
                console.error('경계점 로드 중 오류:', error);
            }   
        };

    

        this.calculateConvexHull = () => {
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
        }

        this.ccw = (a, b, c) => {
            return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        }

        this.isInsideBoundary = (point) => {
            // if (!this.enableBoundary) return true;

            // const hull = this.convexHull;
            // let inside = false;
            // for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
            //     const xi = hull[i].x, yi = hull[i].y;
            //     const xj = hull[j].x, yj = hull[j].y;
                
            //     const intersect = ((yi > point.y) !== (yj > point.y))
            //         && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            //     if (intersect) inside = !inside;
            // }
            // return inside;
        }

        this.getClosestPointOnBoundary = (point) => {
            // const hull = this.convexHull;
            // let closestPoint = hull[0];
            // let minDistance = point.distanceTo(hull[0]);

            // for (let i = 1; i < hull.length; i++) {
            //     const distance = point.distanceTo(hull[i]);
            //     if (distance < minDistance) {
            //         minDistance = distance;
            //         closestPoint = hull[i];
            //     }
            // }

            // return closestPoint;
        }

        // update 메서드 수정
        const originalUpdate = this.update;
        this.update = () => {
            const result = originalUpdate.call(this);

            // if (this.enableBoundary) {
            //     const cameraPos2D = new Vector2(this.object.position.x, this.object.position.y);
            //     if (!this.isInsideBoundary(cameraPos2D)) {
            //         const smoothFactor = 0.1;
            //         const closestPoint = this.getClosestPointOnBoundary(cameraPos2D);
                    
            //         // 부드러운 이동을 위한 선형 보간
            //         const newX = this.object.position.x + (closestPoint.x - this.object.position.x) * smoothFactor;
            //         const newY = this.object.position.y + (closestPoint.y - this.object.position.y) * smoothFactor;
                    
            //         this.object.position.set(newX, newY, this.object.position.z);
                    
            //         // target도 같이 이동 (선택적)
            //         this.target.x += (newX - this.object.position.x);
            //         this.target.y += (newY - this.object.position.y);
            //     }
            // }
        

            return result;
        }   

    }
    
    async loadGraphAndPaths() {
        try {
            // 그래프 연결 데이터와 그래프 포인트 데이터 로드
            const graphConnections = await this.loadGraph('assets/data/cafe/cafe_graph.txt');
            this.graphPoints = await this.loadGraphCam('assets/data/cafe/cafe_centers.txt');
    
            // graphPoints 배열이 정상적으로 로드되었는지 확인
            if (!this.graphPoints || this.graphPoints.length === 0) {
                console.error("Graph Points are empty or undefined");
                return;
            }
    
            // 그래프 구조 생성
            graphConnections.forEach(conn => {
                if (!this.graph.has(conn.from)) this.graph.set(conn.from, new Set());
                if (!this.graph.has(conn.to)) this.graph.set(conn.to, new Set());
    
                // 양방향으로 연결 (from -> to, to -> from)
                this.graph.get(conn.from).add(conn.to);
                this.graph.get(conn.to).add(conn.from);
            });

            // 초기 위치 설정
            this.currentNode = 0;
            console.log("Current Node:", this.currentNode);
            console.log('Position:', this.object.position);

            if (this.currentNode < 0 || this.currentNode >= this.graphPoints.length) {
                console.error("Invalid currentNode:", this.currentNode);
                return;
            }

            this.object.position.copy(this.graphPoints[this.currentNode]); // 카메라를 첫 번째 노드 위치로 설정

            this.lookAtNextNode(); // 카메라의 방향 설정
    
            this.isDataLoaded = true;
            this.animate(); // 데이터 로딩 후 애니메이션 시작
        } catch (error) {
            console.error('Error loading graph and paths:', error);
            console.error('Error details:', error.message);
        }
    }
    
    moveAlongGraph(direction) {
        // currentNode가 유효한지 확인
        if (!this.graph.has(this.currentNode)) {
            console.error('Current node does not exist in the graph');
            return;
        }

        const neighbors = Array.from(this.graph.get(this.currentNode) || new Set()).filter(n => n !== undefined);
        if (neighbors.length === 0) {
            console.error('No neighbors found for current node');
            return;
        }    
        
        console.log('Neighbors of Current Node:', neighbors);


        let nextNode;
        if (direction === 'forward') {
            nextNode = neighbors[0]; // 앞쪽 노드 선택
            //nextNode = Math.min(...Array.from(neighbors));
        } else if (direction === 'backward') {
            nextNode = neighbors[neighbors.length - 1]; // 뒤쪽 노드 선택

            //nextNode = Math.max(...Array.from(neighbors));
        } else {
            nextNode = neighbors[Math.floor(Math.random() * neighbors.length)]; // 무작위 노드 선택
        }


        if (nextNode !== undefined && this.graphPoints[nextNode]) {
            console.log('Direction:', direction);
            console.log('Current Node:', this.currentNode);
            console.log('Next Node:', nextNode);
            console.log('Target Position for Next Node:', this.graphPoints[nextNode]);
    
            // 카메라의 위치를 업데이트
            this.currentNode = nextNode; // 현재 노드 업데이트
            this.targetPosition = this.graphPoints[this.currentNode];
            this.object.position.copy(this.targetPosition);
            console.log('Updated Camera Position:', this.object.position);
    
            // 카메라가 새 위치를 바라보도록 설정
            this.lookAtNextNode();
        } else {
            console.error('Invalid target node or target position');
        }
    }

    moveInDirectionOfView() {
        if (!this.graph.has(this.currentNode)) {
            console.error('Current node does not exist in the graph');
            return;
        }
    
        // 현재 카메라의 위치와 방향을 가져옴
        const cameraPosition = this.object.position;
        const cameraDirection = new Vector3();
        this.object.getWorldDirection(cameraDirection);
    
        // 카메라의 방향 벡터를 기반으로 가장 가까운 노드 찾기
        const neighbors = Array.from(this.graph.get(this.currentNode) || new Set()).filter(n => n !== undefined);
        if (neighbors.length === 0) {
            console.error('No neighbors found for current node');
            return;
        }
    
        let nextNode = null;
        let maxDotProduct = -Infinity;
    
        for (const neighbor of neighbors) {
            const neighborPosition = this.graphPoints[neighbor];
            if (neighborPosition) {
                // 현재 노드와 이웃 노드 간의 벡터를 계산
                const directionToNeighbor = neighborPosition.clone().sub(cameraPosition).normalize();
    
                // 방향 벡터의 내적을 통해 카메라가 바라보는 방향과의 유사도 계산
                const dotProduct = cameraDirection.dot(directionToNeighbor);
    
                // 가장 유사한 방향을 가지는 노드 선택
                if (dotProduct > maxDotProduct) {
                    maxDotProduct = dotProduct;
                    nextNode = neighbor;
                }
            }
        }
    
        if (nextNode !== null) {
            // 카메라의 위치를 업데이트
            this.currentNode = nextNode;
            this.object.position.copy(this.graphPoints[this.currentNode]);
    
            // 카메라가 새 위치를 바라보도록 설정
            this.lookAtNextNode();
        } else {
            console.error('No suitable node found in the direction of view');
        }
    }
    
    lookAtNextNode() {
        if (this.currentNode === null || this.targetPosition === undefined) return;

        const targetPosition = this.graphPoints[this.currentNode];
        if (targetPosition && targetPosition instanceof Vector3) { // Vector3 객체인지 확인
            this.object.lookAt(targetPosition);
            console.log('Looking at Target Position:', targetPosition);
        } else {
            console.error('Invalid target position or not a Vector3 object:', targetPosition);
        }
    }

    update(deltaTime) {
        if (!this.isDataLoaded || this.targetNode === null) return;

        const currentPosition = this.object.position;
        const targetPosition = this.graphPoints[this.targetNode];
        
        // 위치 보간
        currentPosition.lerp(targetPosition, this.movementSpeed * deltaTime);
        
        // 회전 보간
        const targetQuaternion = new Quaternion().setFromRotationMatrix(
            new Matrix4().lookAt(targetPosition, currentPosition, this.object.up)
        );
        this.object.quaternion.slerp(targetQuaternion, this.rotationSpeed * deltaTime);

        // 목표 지점에 도달했는지 확인
        if (currentPosition.distanceTo(targetPosition) < 0.1) {
            this.currentNode = this.targetNode;
            this.targetNode = null;
        }
    }

    // loadGraph, loadGraphCam 메서드는 기존과 동일
    async loadGraphCam(filePath){
        try {
            const response = await fetch(filePath);
            const text = await response.text();
            const points = text.split('\n').map(line => {
                const [x, y, z] = line.split(' ').map(Number);
                return new Vector3(x, y, z); // THREE.Vector3로 변경
            });

            //console.log('Loaded graphCam points:', points); // 로그 출력
            return points;
        } catch (error) {
            console.error('Error loading graphCam:', error);
        }
    }

    // graph 데이터를 로드하는 함수
    async loadGraph(filePath){
        try {
            const response = await fetch(filePath);
            const text = await response.text();
            const connections = text.split('\n').map(line => {
                const [from, to] = line.split(' ').map(Number); // 시작점과 끝점을 나타내는 인덱스
                return { from, to };
            });

            //console.log('Loaded graph connections:', connections); // 로그 출력
            return connections;
        } catch (error) {
            console.error('Error loading graph:', error);
        }
    }

    // // 경로를 생성하는 함수
    // async createPaths(connections, points){
    //     if (!Array.isArray(connections) || !Array.isArray(points)) {
    //         throw new Error('Connections or points are not arrays');
    //     }

    //     const paths = connections.map(conn => {
    //         const start = points[conn.from];
    //         const end = points[conn.to];
    //         return { start, end };
    //     });
    //     return paths;
    // }

    // // 그래프와 경로를 로드하는 함수
    // async loadGraphAndPaths(){
    //     try {
    //         const graphConnections = await this.loadGraph('assets/data/cafe/cafe_graph.txt'); // 경로 수정 필요
    //         const graphPoints = await this.loadGraphCam('assets/data/cafe/cafe_cameras.txt');  // 경로 수정 필요

    //         if (!Array.isArray(graphConnections) || !Array.isArray(graphPoints)) {
    //             throw new Error('Loaded data is not in the expected format');
    //         }

    //         this.paths = await this.createPaths(graphConnections, graphPoints);

    //         if (!this.paths || this.paths.length === 0) {
    //             console.error('Paths are not loaded correctly');
    //             return;
    //         }

    //         this.isDataLoaded = true; // 데이터 로드 완료 상태
    //     } catch (error) {
    //         console.error('Error loading graph and paths:', error);
    //     }
    // }
    // // 카메라를 경로에 따라 이동하는 함수
    // moveAlongPath(camera, paths, direction, moveSpeed) {
    //     if (!paths || paths.length === 0) {
    //         console.error('Paths array is empty or undefined');
    //         return; // paths가 비어있으면 리턴
    //     }

    //     const currentPath = paths[this.currentPathIndex];

    //     if (!currentPath || !currentPath.start || !currentPath.end) {
    //         console.error('currentPath, start or end is undefined', currentPath);
    //         return; // currentPath, start, end가 undefined면 리턴
    //     }

    //     // 방향에 따라 경로를 따라 이동
    //     if (direction === 'forward') {
    //         this.pathProgress += moveSpeed;
    //     } else if (direction === 'backward') {
    //         this.pathProgress -= moveSpeed;
    //     }

    //     // pathProgress 값이 NaN인지 확인
    //     if (isNaN(this.pathProgress)) {
    //         console.error('pathProgress is NaN:', this.pathProgress);
    //     } else {
    //         console.log('Path progress (after):', this.pathProgress);
    //     }
        
    //     // 경로가 끝나면 다음 경로로 이동
    //     if (this.pathProgress >= 1) {
    //         this.pathProgress = 0;
    //         this.currentPathIndex = (this.currentPathIndex + 1) % paths.length; // 순환 경로
    //     } else if (this.pathProgress <= 0) {
    //         this.pathProgress = 1;
    //         this.currentPathIndex = (this.currentPathIndex - 1 + paths.length) % paths.length;
    //     }else if (this.pathProgress < 0 || this.pathProgress > 1) {
    //         console.error('Path progress out of bounds:', this.pathProgress);
    //     }

    //     // 카메라 위치를 현재 경로의 진행도에 따라 업데이트
    //     const start = currentPath.start.clone();
    //     const end = currentPath.end.clone();

    //     // start와 end의 Vector3 값이 정상적인지 확인
    //     console.log('Start point:', start);
    //     console.log('End point:', end);


    //     if (!start || !end || isNaN(start.x) || isNaN(end.x)) {
    //         console.error('Start or end point is undefined:', start, end);
    //         return;
    //     }

    //     camera.position.lerpVectors(start, end, this.pathProgress);

    //     console.log('Camera position:', camera.position); // 카메라 위치 출력

    // }
    
    animate() {
        const deltaTime = this.clock.getDelta();
        this.update(deltaTime);
        requestAnimationFrame(() => this.animate());

    }

}
// OrbitControls 생성 및 초기화 함수
async function createOrbitControls(camera, domElement, boundaryFilePath, graphCamFilePath, graphFilePath) {
    const controls = new OrbitControls(camera, domElement);
    await controls.loadBoundaryPoints(boundaryFilePath);
    //graphConnections = await controls.loadGraphCam(graphCamFilePath);
    //graphPoints = await controls.loadGraph(graphFilePath);
    return controls;
}

export { OrbitControls, createOrbitControls };