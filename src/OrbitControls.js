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

        // function moveOut(moveSpeed){
        //     const movementDirection = new Vector3();
        //     scope.object.getWorldDirection(movementDirection);
        //     movementDirection.z = 0; // Set z component to 0
        //     movementDirection.normalize(); // Renormalize the vector
        //     scope.object.position.addScaledVector(movementDirection, -moveSpeed);
        // }
        // function moveIn(moveSpeed){
        //     const movementDirection = new Vector3();
        //     scope.object.getWorldDirection(movementDirection);
        //     movementDirection.z = 0; // Set z component to 0
        //     movementDirection.normalize(); // Renormalize the vector
        //     scope.object.position.addScaledVector(movementDirection, moveSpeed);
        // }
        // function moveLeft(moveSpeed){
        //     const movementDirection = new Vector3();
        //     scope.object.getWorldDirection(movementDirection);
        //     movementDirection.z = 0; // Set z component to 0
        //     movementDirection.normalize(); // Renormalize the vector

        //     // 카메라의 오른쪽 방향 계산
        //     const leftVector = new Vector3();
        //     leftVector.crossVectors(movementDirection, scope.object.up).normalize();
        //     scope.object.position.addScaledVector(leftVector, -moveSpeed);
        // }
        // function moveRight(moveSpeed){
        //     const movementDirection = new Vector3();
        //     scope.object.getWorldDirection(movementDirection);
        //     movementDirection.z = 0; // Set z component to 0
        //     movementDirection.normalize(); // Renormalize the vector

        //     // 카메라의 오른쪽 방향 계산
        //     const rightVector = new Vector3();
        //     rightVector.crossVectors(movementDirection, scope.object.up).normalize();
        //     scope.object.position.addScaledVector(rightVector, moveSpeed);
        // }
        
        // 카메라가 현재 바라보는 방향으로 이동
        function getForwardDirection() {
            const direction = new Vector3();
            if (scope.object && scope.object instanceof Object3D) {
                scope.object.getWorldDirection(direction);
                //scope.object.position.y = 0.955; // 수평 이동만 고려
                direction.normalize();
                return direction;
            } else {
                console.error('Object is not defined or is not an instance of THREE.Object3D');
                return new Vector3();
            }
        }
        // 카메라가 현재 바라보는 방향의 반대로 이동
        function getBackwardDirection() {
            return getForwardDirection().negate();
        }
        

        // 카메라의 왼쪽 방향으로 이동
        function getRightDirection() {
            const direction = new Vector3();
            if (scope.object && scope.object instanceof Object3D) {
                scope.object.getWorldDirection(direction);
                //scope.object.position.z = 0.955; // 수평 이동만 고려
                const rightDirection = new Vector3().crossVectors(direction, scope.object.up);
                //const rightDirection = new Vector3().crossVectors(direction, new Vector3(0,1,0));
                rightDirection.normalize();
                return rightDirection;
            } else {
                console.error('Object is not defined or is not an instance of THREE.Object3D');
                return new Vector3();
            }
        }
        // 카메라의 오른쪽 방향으로 이동
        function getLeftDirection() {
            return getRightDirection().negate();
        }

        const baseMoveSpeed = 0.2; // 기본 이동 속도

        this.updateCameraMovement = (deltaTime) => {
            if (!this.isDataLoaded || !this.roads || this.roads.length === 0) {
                return;
            }
            const moveSpeed = baseMoveSpeed * deltaTime;
            let movement = new Vector3();

            if (keysPressed.UP) {
                movement = getForwardDirection().multiplyScalar(moveSpeed);
                //console.log("test");
            }
            if (keysPressed.DOWN) {
                movement = getBackwardDirection().multiplyScalar(moveSpeed);
            }
            if (keysPressed.LEFT) {
                movement = getLeftDirection().multiplyScalar(moveSpeed);
            }
            if (keysPressed.RIGHT) {
                movement = getRightDirection().multiplyScalar(moveSpeed);
            }
            const newPosition = this.object.position.clone().add(movement);     
            let isWithinRoad = false;
            let roadWidth = 0.2;

            // 도로 내에 있는지 확인
            for (const road of this.roads) {
                if (isPointInsideRoad(newPosition, road, roadWidth)) {
                    isWithinRoad = true;
                    break;
                }
            }

            if (isWithinRoad) {
                this.object.position.copy(newPosition);
            }

        };

        function isPointInsideRoad(point, road, roadWidth) {
            // 도로 내에 있는지 확인하는 함수
            const toPoint = new Vector3().subVectors(point, road.centerStart);
            const toEnd = new Vector3().subVectors(road.centerEnd, road.centerStart);
        
            const projection = toPoint.dot(toEnd) / toEnd.lengthSq();
            // 0 <= projection <= 1을 벗어나면 도로의 시작 또는 끝을 넘어선 것
            if (projection < 0 || projection > 1) {
                return false;
            }
            const closestPoint = new Vector3().copy(road.centerStart).add(toEnd.multiplyScalar(projection));
        
            const distance = closestPoint.distanceTo(point);

            return distance <= roadWidth / 2;
        }
        // // animate 메서드도 생성자 내부에 정의하고 this에 바인딩
        // this.animate = () => {
        //     if (this.clock) {
        //         const deltaTime = this.clock.getDelta();
        //         this.updateCameraMovement(deltaTime);
        //     }
        //     requestAnimationFrame(this.animate);
        // };

        // 초기화 및 애니메이션 시작
        this.loadGraphAndPaths().then(() => {
            this.animate();
        });
        this.animate = () => {
            if (this.clock) {
                const deltaTime = this.clock.getDelta();
                this.updateCameraMovement(deltaTime); // 기존 카메라 움직임 처리
        
                // isMoving이 true일 때 카메라 이동 처리
                if (this.isMoving) {
                    const elapsed = (performance.now() - this.startTime) / 1000; // 경과 시간 (초 단위)
                    const duration = 1.5; // 카메라 이동 지속 시간
                    const t = Math.min(elapsed / duration, 1); // 0에서 1 사이의 비율 계산
        
                    // 카메라의 위치를 점진적으로 목표 위치로 이동
                    this.object.position.lerpVectors(this.startPosition, this.targetPosition, t);
        
                    if (t >= 1) {
                        this.isMoving = false; // 이동 완료
                        console.log("카메라 이동 완료!");
                    }
                }
            }
        
            requestAnimationFrame(this.animate); // 애니메이션 프레임 요청
        };

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
                    if(scope.originCursor){
                        console.log("pick", scope.originCursor);
                        scope.moveCameraToClosestGraphPoint();
                    }
                    
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
        this.domElement.addEventListener('mousedown', onMouseDown.bind(this));  // this를 명시적으로 바인딩

        // force an update at start

        this.update();
    
 

    }
    
    async loadGraphAndPaths() {
        try {
            this.graphConnections = await this.loadGraph('assets/data/cafe/cafe_graph.txt');
            this.graphPoints = await this.loadGraphCam('assets/data/cafe/cafe_centers.txt');
            
            // graphConnections가 유효한지 확인
            if (!this.graphConnections || this.graphConnections.length === 0) {
                console.error("Graph Connections are empty or undefined");
                return;
            }

            // graphPoints 배열이 정상적으로 로드되었는지 확인
            if (!this.graphPoints || this.graphPoints.length === 0) {
                console.error("Graph Points are empty or undefined");
                return;
            }
        
            this.roads = this.createRoads(this.graphConnections, this.graphPoints);
        
            this.isDataLoaded = true;
            this.animate();
        } catch (error) {
            console.error('Error loading graph and paths:', error);
        }
    }
    createRoads = (connections, points) => {
        return connections.map(conn => {
            const start = points[conn.from];
            const end = points[conn.to];

            // 유효성 검사: start 또는 end가 undefined일 경우 로그 출력 후 null 반환
            if (!start || !end) {
                console.error(`Invalid connection: start or end is undefined for connection from ${conn.from} to ${conn.to}`);
                return null; // null을 반환하여 이 경로를 건너뜀
            }     
            
            return {
                centerStart: start,
                centerEnd: end
            };
        }).filter(road => road !== null); // 유효하지 않은 로드 제거
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
    
            const connections = text.split('\n').map((line, index) => {
                // 공백 제거 및 빈 줄 체크
                line = line.trim();
                if (line === '') return null; // 빈 줄이면 null 반환
    
                const parts = line.split(' ').map(Number); // 공백으로 나눈 후 숫자로 변환
                
                // 유효성 검사: parts 배열이 길이 2가 아니거나, NaN이 포함된 경우 건너뜀
                if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                    console.warn(`Invalid line skipped at index ${index}: ${line}`); // 잘못된 줄을 건너뜀
                    return null; 
                }
    
                return { from: parts[0], to: parts[1] };
            }).filter(conn => conn !== null); // 유효하지 않은 연결을 필터링
    
            //console.log('Loaded graph connections:', connections); // 로그 출력
            return connections;
        } catch (error) {
            console.error('Error loading graph:', error);
            return null;
        }
    }
    async raypoint(originCursor) {
        // origin 값이 전달되었는지 확인
        if (originCursor) {
            console.log("Raypoint called with origin:", originCursor);
            this.originCursor = originCursor;
            // 여기에 origin 값을 사용한 추가 로직을 구현
        } else {
            console.error("Origin value not provided");
        }
    }
    // 다익스트라
    calculateShortestPath(graphConnections, graphPoints, startIdx, targetIdx) {
        const distances = Array(graphPoints.length).fill(Infinity);
        const previousNodes = Array(graphPoints.length).fill(null);
        const visited = new Set();
        const queue = [];
    
        // 시작점의 거리와 초기화
        distances[startIdx] = 0;
        queue.push({ index: startIdx, distance: 0 });

        while (queue.length > 0) {
            // 우선순위 큐처럼 사용
            const { index: currentIdx } = queue.shift();
            if (visited.has(currentIdx)) continue;
            visited.add(currentIdx);
    
            // 현재 노드와 연결된 모든 이웃을 확인
            graphConnections.forEach(({ from, to }) => {
                if (from === currentIdx || to === currentIdx) {
                    const neighborIdx = (from === currentIdx) ? to : from;
                    const distance = graphPoints[currentIdx].distanceTo(graphPoints[neighborIdx]);
    
                    // 더 짧은 경로를 찾으면 업데이트
                    if (distances[currentIdx] + distance < distances[neighborIdx]) {
                        distances[neighborIdx] = distances[currentIdx] + distance;
                        previousNodes[neighborIdx] = currentIdx;
                        queue.push({ index: neighborIdx, distance: distances[neighborIdx] });
                    }
                }
            });
        }
    
        // 목표점에서 시작하여 역으로 경로를 추적
        const path = [];
        for (let at = targetIdx; at !== null; at = previousNodes[at]) {
            path.push(at);
        }
        return path.reverse(); // 경로는 역순으로 저장되므로 뒤집어 반환
    }

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
            const path = this.calculateShortestPath(this.graphConnections, this.graphPoints, currentClosestPointIndex, closestPointIndex);
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

}
// OrbitControls 생성 및 초기화 함수
async function createOrbitControls(camera, domElement, viewer) {
    const controls = new OrbitControls(camera, domElement, viewer);
    //await controls.loadBoundaryPoints(boundaryFilePath);
    //graphConnections = await controls.loadGraphCam(graphCamFilePath);
    //graphPoints = await controls.loadGraph(graphFilePath);
    return controls;
}

export { OrbitControls, createOrbitControls };
