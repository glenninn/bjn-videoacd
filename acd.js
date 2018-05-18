var https = require('https');
var http  = require('http');
var fs    = require("fs");
var express=require("express");
var bodyParser = require("body-parser");
var app = express();
var router = express.Router();

// Set port apropos for Heroku
var ourPort = process.env.PORT || 80;
var secPort = 443;

var sslOptions = {
	cert: fs.readFileSync("./certs/server.crt"),
	key:  fs.readFileSync("./certs/server.pem")
};

var httpsServer = https.createServer(sslOptions,app);
var server = httpsServer.listen(secPort, ()=>{
	console.log("HTTPS Server listening on port: " + secPort);
});

// database "Key" field value
var idCounter = 1000;

// This web service's ACD call queue
var theQueue = [];


var appVersion = "1.1.0";
// 1.0.0  - basic http functionality
// 1.1.0  - moved to https

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
		name: "Jenny Patient",
		numericMeetingId : "12345123000",
		requested : Date.now() - 1500
	},
	{  
		id : idCounter++,
		name: "Wong Jackman",
		numericMeetingId : "12345123001",
		requested : Date.now() - 5500
	},
	{  
		id : idCounter++,
		name: "Bruce Lee",
		numericMeetingId : "12345123002",
		requested : Date.now() - 10500
	},
	{  
		id : idCounter++,
		name: "Susan Whang",
		numericMeetingId : "12345123003",
		requested : Date.now() - 110500
	},
	{  
		id : idCounter++,
		name: "Ted Tracy",
		numericMeetingId : "12345123004",
		requested : Date.now() - 150000
	}
];


app.use( express.static(__dirname + "/html"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded( {extended: true} ));

app.use("/",router);

// Routine to create the BlueJeans launch URL
//   /webrtc -- force using Web based 
//   /quick  -- bypass entry steps, go into meeting quickly
// If the Agents are not using WebRTC, then do not append these strings
// to the URL
function makeVideoUrl(peep){
	peep.bluejeans = "https://bluejeans.com/" + peep.numericMeetingId + "/webrtc/quick";
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
	  console.log("/queue  -- adding record!");
	  if(!req.body || !req.body.name || !req.body.numericMeetingId){
		  res.status(400).json( { results: "Invalid object format: name, numericMeetingId"});
	  }
	  req.body.requested = Date.now();
	  req.body.id = idCounter++;
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
	  for(var i=0; i<theQueue.length; i++){
		  if( theQueue[i].id == iWant ){
			  p = theQueue[i];
			  theQueue.splice(i,1);
			  makeVideoUrl(p);
			  console.log("/queue/"+iWant + " Dequeued (" + p.name + ")" );
			  res.status(200).json( p );
			  break;
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
		  makeVideoUrl(p);
		  console.log("/dequeue  Dequeued (" + p.name + ")" );
		  res.status(200).json(p);
	  }
  });
  
function initialize(){
	theQueue = [];
	dummyQ.forEach( (item)=>{
		theQueue.splice(0,0,item);
	});
}

initialize();

app.listen(ourPort, ()=>{
console.log("\n*** ACD is up and listening on Port: " + ourPort);
});	

