var https = require('https');
var http  = require('http');
var fs    = require("fs");
var auth  = require("./auth.js");

var express=require("express");
var bodyParser = require("body-parser");
var app = express();
var router = express.Router();

var secPort = process.env.PORT || 443;

var onHeroku    = false;
var sslOptions  = {};
var httpsServer = null;
var server      = null;

//
//  Check by command line option if this is running in Heroku
//
if(process.argv.length == 3) {
	var opt = process.argv[2];
	opt = opt.toLowerCase();
	
	for(var i=0; i< process.argv.length; i++){
		console.log("arg["+i+"]: " + process.argv[i]);
	}
	
	onHeroku = (opt == "heroku");
}
	


// Set port apropos for Heroku
if(onHeroku) {
	console.log("*** HEROKU SELECTED ***");
	secPort = process.env.PORT || 80;
	app.listen(secPort, ()=>{
		console.log("ON HEROKU, started listening on: " + secPort );
	});
	
} else {
	sslOptions = {
		cert: fs.readFileSync("./certs/server.crt"),
		key:  fs.readFileSync("./certs/server.pem")
	};

	httpsServer = https.createServer(sslOptions,app);
	server = httpsServer.listen(secPort, ()=>{
		console.log("HTTPS Server listening on port: " + secPort);
	});
}


// database "Key" field value
var idCounter = 1000;

// This web service's ACD call queue
var theQueue = [];


var appVersion = "1.2.0";
// 1.0.0  - basic http functionality
// 1.1.0  - moved to https
// 1.2.0  - add BlueJeans scheduling

/* Video ACD static HTML pages
	(/html/)index.html  standard landing page showing realtime ACD call status
	(/html/)addme.html	Page that allows you to add an entry to ACD, and
						Reset the ACD
*/

/* Video ACD API's 
   /queue		 (GET) return entire ACD queue
				 (POST) Add to end of Queue the record
				 {
					 name: "string",
					 numericMeetingId: "string"
				 }
				 The numericMeetingId is the dialable meeting ID from 
				 scheduling a BlueJeans meeting
   /queue/{id}	 (GET) return element in ACD whose ID value is {id}
   /queue/{id}/where (GET) Show what position {id} is in call queue
   /queue/status (GET) return status of the ACD system
   /queue/reset	 (GET) reset the ACD queue to initial "dummy" value
   
   
	*************************************
   /dequeue		 (GET) pop the top of the queue and return
   /dequeue/{id} (GET) pop the element in ACD whose ID value is {id}
				 (DELETE) Remove the element in ACD whose ID value is {id}
	**
	**  The dequeue API's construct the BlueJeans URL and add it to
	**  the returned JSON record
	*************************************
*/


// Dummy Call Queue to demonstrate functionality
var dummyQ = [
	{  
		id : idCounter++,
		name: "Second Inline",
		numericMeetingId : "",
		requested : Date.now() - 5500
	},
	{  
		id : idCounter++,
		name: "Jenny Patient",
		numericMeetingId : "",
		requested : Date.now() - 1500
	}	
];


app.use( express.static(__dirname + "/html"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded( {extended: true} ));

app.use("/",router);

//
// BlueJeans API-related constants
//
var host           = "api.bluejeans.com";
var accessTokenAPI = "/oauth2/token";
var schedMeetingAPI   = "/v1/user/{userId}/scheduled_meeting";


//
// BlueJeans OAuth information
//
var configFile = "config.json";
var oauthInfo = {};
var ourTokenInfo = null;

//
// Function to return BlueJeans OAUTH access token.  If the token is
// non-existent, or expired, the function will renew with BlueJeans
//
function getAccessToken() 
{
	var p = new Promise( (resolve,reject) =>{
		
		if(  !ourTokenInfo || (ourTokenInfo.expiresAt < Date.now()) ){
			console.log("token expired, renewing client session");
			auth.post(host,accessTokenAPI,oauthInfo).then(  (results)=> {
				
				ourTokenInfo = {
					access_token : results.access_token,
					expiresAt    : Date.now() + (1000*results.expires_in)
				};
				
				console.log("Obtained BlueJeans OAUTH token: " + ourTokenInfo.access_token);
				auth.authorize(ourTokenInfo.access_token);
				resolve(ourTokenInfo.access_token);
			}, (error)=> {
				console.log("%Failed to renew OAUTH token: " + error);
				reject(error);
			});
		} else {
			resolve(ourTokenInfo.access_token);
		}
		
	});
	
	return p;
}


//
// Function to schedule a quick meeting in BlueJeans
//
function ScheduleBlueJeans(peep)	// userId,usePasscode, callback)
{
	var when = new Date().getTime();
	var howManyMinutes = 15;
	
	var mtgDetails = {
		title: 'ACD Meeting #' + peep.id,
		endPointVersion: '2.10',
		endPointType: 'WEB_APP',
		timezone: "America/Los_Angeles",
		start: when,
		end: when + howManyMinutes * 60 * 1000,
		advancedMeetingOptions: {
			moderatorLess : true
		}
	};
	
	var url = schedMeetingAPI.replace(/{userId}/, oauthInfo.userId);
	url += "?email=false";
	
	var p = new Promise( (resolve,reject)=> {
		
		//
		// Get our BlueJeans Access token	
		getAccessToken().then( (token)=> {
		
			// Now schedule a BlueJeans Meeting
			auth.post(host,url,mtgDetails).then( (mtgResults)=> {
				
				// Success ...
				console.log("-->Schedule BJN meeting: " + mtgResults.numericMeetingId);
				resolve(mtgResults);
				
			}, (mtgError)=> {
				
				// Failed to schedule...
				console.log("???Error Scheduling meeting: " + JSON.stringify(mtgError) );
				reject(error);
				
			});
			
		}, (error)=> {
			
			// Failed to get an Access Token
			reject(error);
			
		});
		
	});
	
	return p;
}


// Routine to create the BlueJeans launch URL
//   /webrtc -- force using Web based 
//   /quick  -- bypass entry steps, go into meeting quickly
// If the Agents are not using WebRTC, then do not append these strings
// to the URL
function makeVideoUrl(peep){
	var p = new Promise( (resolve,reject)=> {
		
		ScheduleBlueJeans(peep).then( (mtgDetails)=> {
			
			peep.numericMeetingId = mtgDetails.numericMeetingId;
			peep.meetingId = mtgDetails.id;
			peep.bluejeans = "https://bluejeans.com/" + peep.numericMeetingId + "/webrtc/quick";
			console.log("BlueJeans Meeting: " + peep.bluejeans );
			
			resolve(peep.bluejeans);
			
		}, (error)=> {
			
			peep.numericMeetingId = null;
			peep.meetingId = null;
			peep.bluejeans = "";

			reject(peep.bluejeans);
			
		});
	
	});
	
	return p;
}


// Show the status of the ACD service
function acdStatus(){
	var s = {
		  version: appVersion,
		  time: Date.now(),
		  count: theQueue.length,
		  nextId : idCounter
	  };
	return s;
}


router.route("/queue")
  .get( (req,res)=>{
	res.status(200).json( theQueue );
  })
  .post( (req,res)=>{
	  if(!req.body || !req.body.name ){
		  console.log("/queue -- fail to add record, invalid format");
		  res.status(400).json( { results: "Invalid object format: name, numericMeetingId"});
	  }
	  console.log("/queue  -- adding record (" + req.body.name +")");
	  req.body.requested = Date.now();
	  req.body.id = idCounter++;
	  req.body.selected = false;
	  theQueue.push(req.body);
	  res.status(200).json( {results: "ok",
							 caller : req.body } );
  });
  
router.route("/queue/status")
  .get( (req,res)=>{
	  var resp = acdStatus(); 
	  res.status(200).json(resp);	  
  });
  
router.route("/queue/reset")
  .get( (req,res)=>{
	  console.log("/queue/reset - Resetting ACD queue");
	  initialize();
	  var resp = acdStatus(); 
	  res.status(200).json(resp);	  
  });


router.route("/queue/:id")
  .get( (req,res)=>{
	  var iWant;
	  try{
		  iWant = parseInt( req.params.id );
	  }catch(e) {
		  console.log("/queue/"+req.params.id+":  Invalid index");
		  res.status(500).json({results:"invalid index: " + req.params.id});
		  return;
	  };
	  
	  var p = null;
	  for(var i=0; i<theQueue.length; i++){
		  if( theQueue[i].id == iWant ){
			  p = theQueue[i];
			  break;
		  }
	  }
	  if( p ) {
		  console.log("/queue/"+iWant+":  GET ok! (" + p.name +")");
		  res.status(200).json( p );
	  } else {
		  console.log("/queue/"+iWant+":  Person not in queue");
		  res.status(500).json({ results: "Person not in queue"});
	  }
	  
  })
  .delete( (req,res)=>{
	  var iWant;
	  try{
		  iWant = parseInt( req.params.id );
	  }catch(e) {
		  console.log("/queue/"+req.params.id+":  Invalid index");
		  res.status(500).json({results:"invalid index: " + req.params.id});
		  return;
	  };
	  
	  var p = null;
	  for(var i=0; i<theQueue.length; i++){
		  if( theQueue[i].id == iWant ){
			  p = theQueue[i];
			  theQueue.splice(i,1);
			  console.log("/queue/"+iWant + " Removed (" + p.name + ")" );
			  res.status(200).json( { results: "Removed " + iWant } );
			  break;
		  }
	  }
	  if( p==null ) {
		  console.log("/queue/"+iWant+":  Person not in queue");
		  res.status(500).json({ results: "Person not in queue"});
	  }
  });
  
router.route("/queue/:id/where")
  .get( (req,res)=>{
	  var pos = -1;
	  for(var i=0; (i<theQueue.length) && (pos<0); i++){
		  if(req.params.id == theQueue[i].id){
			  pos = i;
		  }
	  }
	  console.log("Finding user id(" + req.params.id + ") position: " + pos );
	  var whereInfo = {
		position : pos,
		selected : (pos>=0) ? theQueue[pos].selected : false
	  };
	  res.status(200).json( whereInfo );
  });
  
  
router.route("/dequeue/:id")
  .get( (req,res)=>{
	  var iWant;
	  try{
		  iWant = parseInt( req.params.id );
	  }catch(e) {
		  console.log("/queue/"+req.params.id+":  Invalid index");
		  res.status(500).json({results:"invalid index: " + req.params.id});
		  return;
	  };
	  
	  var p = null;
	  var done = false;
	  
	  for(var i=0; (i<theQueue.length) && !done; i++){
		  if( theQueue[i].id == iWant ){
			  p = theQueue[i];
			  if(theQueue[i].selected)
				  theQueue.splice(i,1);	// remove from queue
			  console.log("/queue/"+iWant + " Dequeued (" + p.name + ")" );

			  if(p.meetingId) {
				res.status(200).json( p.bluejeans );
			  } else {
				makeVideoUrl(p).then( (theUrl)=> {
					res.status(200).json( theUrl );
				  
				}, (noUrl)=>{
					res.status(401).json(noUrl);
				});
			  }
			  done = true;
		  }
	  }
	  if( p==null ) {
		  console.log("/queue/"+iWant+":  Person not in queue");
		  res.status(500).json({ results: "Person not in queue"});
	  }
 });

 
router.route("/dequeue")
  .get( (req,res)=>{
	  if(theQueue.length == 0){
		  res.status(500).json( { results: "Queue is empty" } );
		  console.log("/dequeue:  Queue is empty");
	  } else {
		  p = theQueue[0];
		  theQueue.splice(0,1);
		  console.log("/dequeue  Dequeued (" + p.name + ")" );
		  
		  if(p.meetingId) {
			  res.status(200).json( p.bluejeans );
		  } else {
			  makeVideoUrl(p).then( (theUrl)=> {
				res.status(200).json( theUrl );
				  
			  }, (noUrl)=>{
				res.status(401).json(noUrl);
			  });
		  }
	  }
  });
  
router.route("/select/:id")
  .get( (req,res)=>{
	  var iWant;
	  try{
		  iWant = parseInt( req.params.id );
	  }catch(e) {
		  console.log("/select/"+req.params.id+":  Invalid index");
		  res.status(500).json({results:"invalid index: " + req.params.id});
		  return;
	  };
 	  var p = null;
	  var done = false;
	  
	  for(var i=0; (i<theQueue.length) && !done; i++){
		  if( theQueue[i].id == iWant ){
			  p = theQueue[i];
			  theQueue[i].selected = true;	// flag this appt as selected by an agent
			  console.log("/select/"+iWant + " Dequeued (" + p.name + ")" );

			  makeVideoUrl(p).then( (theUrl)=> {
				  res.status(200).json( theUrl );
				  
			  }, (noUrl)=>{
				  res.status(401).json(noUrl);
			  });
			  done = true;
		  }
	  }
	  if( p==null ) {
		  console.log("/queue/"+iWant+":  Person not in queue");
		  res.status(500).json({ results: "Person not in queue"});
	  }
 });
 
  
  
function initialize(){
	console.log("** Initializing ***");
	
	if(onHeroku) {
		//
		// We're running on Heroku.  Read OAuth info from Process Environment
		//
		
		oauthInfo = {
			grant_type    : "client_credentials",
			client_id     : process.env.CLIENT_ID,
			client_secret : process.env.CLIENT_SECRET,
			userId        : process.env.userId
		};
		
	} else {

		// Read from environment, the OAuth Credentials
		//
		fs.readFile(".\\" + configFile, (err,data)=> {
			if(err) {
				console.log("Error reading file: " + configFile +"\n"+err);
				process.exit();
			}
			var sd = data.toString();
			try
			{
				oauthInfo = JSON.parse(sd);
				console.log("Read Config File: " + JSON.stringify(oauthInfo,null,2) );
			}
			catch(e){
				console.log("Error parsing config file: " + configFile );
				process.exit();
			}
		});
	}
	
	//
	// Initialize the internal-memory Call Queue
	//
	theQueue = [];
	dummyQ.forEach( (item)=>{
		theQueue.splice(0,0,item);
	});
}	

initialize();
